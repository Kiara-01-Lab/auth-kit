/**
 * Stripe Integration Service for AuthKit
 * Handles Stripe subscription management and webhooks
 */

const Stripe = require('stripe');

class StripeService {
  constructor(stripeSecretKey, authKit) {
    if (!stripeSecretKey) {
      throw new Error('Stripe secret key is required');
    }
    if (!authKit) {
      throw new Error('AuthKit instance is required');
    }

    this.stripe = new Stripe(stripeSecretKey);
    this.authKit = authKit;
  }

  /**
   * Create or retrieve a Stripe customer for a user
   */
  async createCustomer(userId, email, metadata = {}) {
    const user = await this.authKit.getUser(userId);
    if (!user) throw new Error('User not found');

    // Check if user already has a Stripe customer
    const existingSub = await this.authKit.getSubscription(userId);
    if (existingSub && existingSub.stripe_customer_id) {
      return await this.stripe.customers.retrieve(existingSub.stripe_customer_id);
    }

    // Create new customer
    const customer = await this.stripe.customers.create({
      email: email || user.email,
      metadata: {
        user_id: userId,
        ...metadata,
      },
    });

    return customer;
  }

  /**
   * Create a Stripe subscription for a user
   */
  async createSubscription(userId, planIdOrName, { billing_cycle = 'monthly', trial_days = 0 } = {}) {
    // Get plan
    const plan = await this.authKit.getPlan(planIdOrName);
    if (!plan) throw new Error('Plan not found');

    // Get or create customer
    const user = await this.authKit.getUser(userId);
    const customer = await this.createCustomer(userId, user.email);

    // Determine price ID
    const priceId = billing_cycle === 'yearly' ? plan.stripe_price_id_yearly : plan.stripe_price_id;
    if (!priceId) {
      throw new Error(`Stripe price not configured for ${billing_cycle} billing on plan ${plan.name}`);
    }

    // Create Stripe subscription
    const subscriptionParams = {
      customer: customer.id,
      items: [{ price: priceId }],
      metadata: {
        user_id: userId,
        plan_id: plan.id,
        plan_name: plan.name,
      },
    };

    if (trial_days > 0) {
      subscriptionParams.trial_period_days = trial_days;
    }

    const stripeSubscription = await this.stripe.subscriptions.create(subscriptionParams);

    // Create subscription in AuthKit
    const authKitSub = await this.authKit.subscribe(userId, plan.id, {
      billing_cycle,
      trial_days,
      stripe_customer_id: customer.id,
      stripe_subscription_id: stripeSubscription.id,
    });

    return {
      stripe: stripeSubscription,
      authkit: authKitSub,
    };
  }

  /**
   * Cancel a Stripe subscription
   */
  async cancelSubscription(userId, immediately = false) {
    const sub = await this.authKit.getSubscription(userId);
    if (!sub) throw new Error('No active subscription found');
    if (!sub.stripe_subscription_id) throw new Error('No Stripe subscription found');

    if (immediately) {
      await this.stripe.subscriptions.cancel(sub.stripe_subscription_id);
    } else {
      await this.stripe.subscriptions.update(sub.stripe_subscription_id, {
        cancel_at_period_end: true,
      });
    }

    // Update in AuthKit
    return this.authKit.cancelSubscription(userId, immediately);
  }

  /**
   * Update a subscription's payment method
   */
  async updatePaymentMethod(userId, paymentMethodId) {
    const sub = await this.authKit.getSubscription(userId);
    if (!sub) throw new Error('No active subscription found');
    if (!sub.stripe_customer_id) throw new Error('No Stripe customer found');

    // Attach payment method to customer
    await this.stripe.paymentMethods.attach(paymentMethodId, {
      customer: sub.stripe_customer_id,
    });

    // Set as default payment method
    await this.stripe.customers.update(sub.stripe_customer_id, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });

    return { success: true };
  }

  /**
   * Change subscription plan
   */
  async changePlan(userId, newPlanIdOrName, { billing_cycle = null, prorate = true } = {}) {
    const sub = await this.authKit.getSubscription(userId);
    if (!sub) throw new Error('No active subscription found');
    if (!sub.stripe_subscription_id) throw new Error('No Stripe subscription found');

    const newPlan = await this.authKit.getPlan(newPlanIdOrName);
    if (!newPlan) throw new Error('New plan not found');

    const newBillingCycle = billing_cycle || sub.billing_cycle;
    const priceId = newBillingCycle === 'yearly' ? newPlan.stripe_price_id_yearly : newPlan.stripe_price_id;

    if (!priceId) {
      throw new Error(`Stripe price not configured for ${newBillingCycle} billing on plan ${newPlan.name}`);
    }

    // Update Stripe subscription
    const stripeSubscription = await this.stripe.subscriptions.retrieve(sub.stripe_subscription_id);
    await this.stripe.subscriptions.update(sub.stripe_subscription_id, {
      items: [{
        id: stripeSubscription.items.data[0].id,
        price: priceId,
      }],
      proration_behavior: prorate ? 'create_prorations' : 'none',
      metadata: {
        plan_id: newPlan.id,
        plan_name: newPlan.name,
      },
    });

    // Update in AuthKit
    return this.authKit.changePlan(userId, newPlan.id, { billing_cycle: newBillingCycle, prorate });
  }

  /**
   * Handle Stripe webhook events
   */
  async handleWebhook(event) {
    const { type, data } = event;
    const object = data.object;

    switch (type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        return this._handleSubscriptionUpdated(object);

      case 'customer.subscription.deleted':
        return this._handleSubscriptionDeleted(object);

      case 'invoice.paid':
        return this._handleInvoicePaid(object);

      case 'invoice.payment_failed':
        return this._handleInvoicePaymentFailed(object);

      default:
        console.log(`Unhandled webhook event: ${type}`);
        return { received: true };
    }
  }

  /**
   * Verify Stripe webhook signature
   */
  verifyWebhookSignature(payload, signature, webhookSecret) {
    try {
      return this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (err) {
      throw new Error(`Webhook signature verification failed: ${err.message}`);
    }
  }

  // Private webhook handlers

  async _handleSubscriptionUpdated(subscription) {
    const userId = subscription.metadata.user_id;
    if (!userId) {
      console.error('No user_id in subscription metadata');
      return { error: 'No user_id found' };
    }

    const status = subscription.status;
    const currentPeriodStart = new Date(subscription.current_period_start * 1000).toISOString();
    const currentPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();

    await this.authKit.updateStripeData(userId, {
      stripe_subscription_id: subscription.id,
      stripe_customer_id: subscription.customer,
      status,
    });

    // Update period dates
    const sub = await this.authKit.getSubscription(userId);
    if (sub) {
      await this.authKit.storage.updateSubscription(sub.id, {
        current_period_start: currentPeriodStart,
        current_period_end: currentPeriodEnd,
      });
    }

    return { success: true };
  }

  async _handleSubscriptionDeleted(subscription) {
    const userId = subscription.metadata.user_id;
    if (!userId) return { error: 'No user_id found' };

    await this.authKit.updateStripeData(userId, {
      status: 'cancelled',
    });

    return { success: true };
  }

  async _handleInvoicePaid(invoice) {
    const customerId = invoice.customer;
    const subscriptionId = invoice.subscription;

    if (!subscriptionId) return { success: true };

    // Find user by stripe_customer_id
    const sub = await this.authKit.storage.pool.query(
      'SELECT * FROM subscriptions WHERE stripe_subscription_id = $1',
      [subscriptionId]
    );

    if (sub.rows.length === 0) return { error: 'Subscription not found' };

    const userId = sub.rows[0].user_id;

    await this.authKit.updateStripeData(userId, {
      stripe_latest_invoice_id: invoice.id,
      stripe_payment_intent_status: invoice.payment_intent?.status || 'paid',
      status: 'active',
    });

    return { success: true };
  }

  async _handleInvoicePaymentFailed(invoice) {
    const subscriptionId = invoice.subscription;
    if (!subscriptionId) return { success: true };

    const sub = await this.authKit.storage.pool.query(
      'SELECT * FROM subscriptions WHERE stripe_subscription_id = $1',
      [subscriptionId]
    );

    if (sub.rows.length === 0) return { error: 'Subscription not found' };

    const userId = sub.rows[0].user_id;

    await this.authKit.updateStripeData(userId, {
      stripe_latest_invoice_id: invoice.id,
      stripe_payment_intent_status: invoice.payment_intent?.status || 'failed',
      status: 'past_due',
    });

    return { success: true };
  }
}

module.exports = StripeService;
