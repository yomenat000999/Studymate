import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const LS_API_KEY = process.env.LEMONSQUEEZY_API_KEY;
const LS_STORE_ID = process.env.LEMONSQUEEZY_STORE_ID;

const VARIANT_IDS = {
  'pro-monthly':  '1513043',
  'pro-annual':   '1513044',
  'max-monthly':  '1513048',
  'max-annual':   '1513046',
};

async function getUser(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Access-Control-Allow-Origin', '*');

  const user = await getUser(req.headers.authorization);
  if (!user) return res.status(401).json({ error: '请先登录' });

  const { plan, billing } = req.body;
  const variantKey = `${plan}-${billing}`;
  const variantId = VARIANT_IDS[variantKey];

  if (!variantId) return res.status(400).json({ error: '无效的套餐选项' });

  try {
    const response = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LS_API_KEY}`,
        'Content-Type': 'application/vnd.api+json',
        'Accept': 'application/vnd.api+json',
      },
      body: JSON.stringify({
        data: {
          type: 'checkouts',
          attributes: {
            checkout_data: {
              email: user.email,
              custom: {
                user_id: user.id,
                plan,
                billing,
              },
            },
            checkout_options: {
              embed: false,
              media: false,
              logo: true,
              button_color: '#c8553d',
            },
            product_options: {
              redirect_url: `${process.env.APP_URL || 'https://studymate-smoky-eta.vercel.app'}/?checkout=success&plan=${plan}`,
              receipt_link_url: `${process.env.APP_URL || 'https://studymate-smoky-eta.vercel.app'}/`,
              receipt_thank_you_note: '感谢订阅 StudyMate！你的账号已升级，马上开始学习吧 🎓',
            },
          },
          relationships: {
            store: {
              data: { type: 'stores', id: LS_STORE_ID },
            },
            variant: {
              data: { type: 'variants', id: variantId },
            },
          },
        },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('LS checkout error:', JSON.stringify(data));
      return res.status(500).json({ error: '创建支付链接失败' });
    }

    const checkoutUrl = data.data?.attributes?.url;
    if (!checkoutUrl) return res.status(500).json({ error: '未获取到支付链接' });

    return res.status(200).json({ url: checkoutUrl });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
