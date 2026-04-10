import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PLAN_LIMITS = {
  free:  { transcribe_seconds_limit: 3600,      chat_monthly_limit: 150  },
  pro:   { transcribe_seconds_limit: 108000,     chat_monthly_limit: 200  },
  max:   { transcribe_seconds_limit: 216000,     chat_monthly_limit: 400  },
};

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;

  // Verify signature
  if (secret) {
    const signature = req.headers['x-signature'];
    const hmac = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    if (hmac !== signature) {
      console.error('Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const event = JSON.parse(rawBody.toString());
  const eventName = req.headers['x-event-name'];
  const customData = event.meta?.custom_data || {};
  const userId = customData.user_id;
  const plan = customData.plan; // 'pro' or 'max'

  console.log('Webhook event:', eventName, 'user:', userId, 'plan:', plan);

  if (!userId) return res.status(200).json({ received: true });

  try {
    if (eventName === 'order_created' || eventName === 'subscription_created') {
      // Upgrade user plan
      const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.pro;
      await supabase
        .from('user_usage')
        .upsert({
          user_id: userId,
          plan,
          transcribe_seconds_limit: limits.transcribe_seconds_limit,
          chat_monthly_limit: limits.chat_monthly_limit,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

      console.log(`Upgraded user ${userId} to ${plan}`);
    }

    if (eventName === 'subscription_cancelled' || eventName === 'subscription_expired') {
      // Downgrade to free
      const limits = PLAN_LIMITS.free;
      await supabase
        .from('user_usage')
        .update({
          plan: 'free',
          transcribe_seconds_limit: limits.transcribe_seconds_limit,
          chat_monthly_limit: limits.chat_monthly_limit,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);

      console.log(`Downgraded user ${userId} to free`);
    }

    if (eventName === 'subscription_updated') {
      // Handle plan changes
      const variantId = String(event.data?.attributes?.variant_id || '');
      const VARIANT_TO_PLAN = {
        '1513043': 'pro',
        '1513044': 'pro',
        '1513048': 'max',
        '1513046': 'max',
      };
      const newPlan = VARIANT_TO_PLAN[variantId] || plan;
      if (newPlan) {
        const limits = PLAN_LIMITS[newPlan];
        await supabase
          .from('user_usage')
          .update({
            plan: newPlan,
            transcribe_seconds_limit: limits.transcribe_seconds_limit,
            chat_monthly_limit: limits.chat_monthly_limit,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId);
      }
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
  }

  return res.status(200).json({ received: true });
}
