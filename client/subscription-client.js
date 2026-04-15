/**
 * AuthKit Subscription Client
 *
 * HTTP client for apps (like FastTask) to query AuthKit subscriptions
 *
 * Usage:
 *   const { SubscriptionClient } = require('@getkiara/auth-kit/client/subscription-client');
 *   const client = new SubscriptionClient('http://authkit-url', 'api-key');
 *   const sub = await client.getSubscription(userId);
 */

class SubscriptionClient {
  constructor(authKitUrl, apiKey) {
    if (!authKitUrl) {
      throw new Error('AuthKit URL is required');
    }
    this.baseUrl = authKitUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = apiKey;
  }

  async _fetch(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get user's active subscription with plan details
   */
  async getSubscription(userId) {
    return this._fetch(`/api/subscriptions/user/${userId}`);
  }

  /**
   * Get merged features for a user (plan + overrides)
   */
  async getFeatures(userId) {
    return this._fetch(`/api/subscriptions/user/${userId}/features`);
  }

  /**
   * Check if user has exceeded a limit
   */
  async checkLimit(userId, limitName) {
    return this._fetch(`/api/subscriptions/user/${userId}/check-limit/${limitName}`);
  }

  /**
   * Increment usage for a user
   */
  async incrementUsage(userId, usageType, amount = 1) {
    return this._fetch(`/api/subscriptions/user/${userId}/usage`, {
      method: 'POST',
      body: JSON.stringify({ usageType, amount }),
    });
  }

  /**
   * Get all subscription plans
   */
  async getPlans(activeOnly = true) {
    const query = activeOnly ? '?activeOnly=true' : '';
    return this._fetch(`/api/subscriptions/plans${query}`);
  }

  /**
   * Subscribe a user to a plan
   */
  async subscribe(userId, planIdOrName, options = {}) {
    return this._fetch(`/api/subscriptions/subscribe`, {
      method: 'POST',
      body: JSON.stringify({
        userId,
        planIdOrName,
        ...options,
      }),
    });
  }

  /**
   * Cancel a subscription
   */
  async cancelSubscription(userId, immediately = false) {
    return this._fetch(`/api/subscriptions/user/${userId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ immediately }),
    });
  }

  /**
   * Change subscription plan
   */
  async changePlan(userId, newPlanIdOrName, options = {}) {
    return this._fetch(`/api/subscriptions/user/${userId}/change-plan`, {
      method: 'POST',
      body: JSON.stringify({
        newPlanIdOrName,
        ...options,
      }),
    });
  }
}

/**
 * Direct Database Subscription Client (for same-database access)
 * Use this when AuthKit and your app share the same database
 */
class DirectSubscriptionClient {
  constructor(authKit) {
    if (!authKit) {
      throw new Error('AuthKit instance is required');
    }
    this.authKit = authKit;
  }

  async getSubscription(userId) {
    return this.authKit.getSubscription(userId);
  }

  async getFeatures(userId) {
    return this.authKit.getFeatures(userId);
  }

  async checkLimit(userId, limitName) {
    return this.authKit.checkLimit(userId, limitName);
  }

  async incrementUsage(userId, usageType, amount = 1) {
    return this.authKit.incrementUsage(userId, usageType, amount);
  }

  async getPlans(activeOnly = true) {
    return this.authKit.getPlans(activeOnly);
  }

  async subscribe(userId, planIdOrName, options = {}) {
    return this.authKit.subscribe(userId, planIdOrName, options);
  }

  async cancelSubscription(userId, immediately = false) {
    return this.authKit.cancelSubscription(userId, immediately);
  }

  async changePlan(userId, newPlanIdOrName, options = {}) {
    return this.authKit.changePlan(userId, newPlanIdOrName, options);
  }
}

module.exports = { SubscriptionClient, DirectSubscriptionClient };
