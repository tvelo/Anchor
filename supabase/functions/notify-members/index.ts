// supabase/functions/notify-members/index.ts
// Deploy: npx supabase functions deploy notify-members
// Then set secrets: npx supabase secrets set EXPO_ACCESS_TOKEN=your_token

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
const CHUNK_SIZE = 100

interface NotifyPayload {
  type: 'capsule_media' | 'capsule_unlock' | 'scrapbook_page' | 'new_member' | 'social_like' | 'social_comment' | 'social_follow' | 'space_join' | 'new_message'
  capsule_id?: string
  scrapbook_id?: string
  target_user_id?: string
  actor_id: string
  actor_name: string
  title: string
  body: string
  data?: Record<string, unknown>
}

Deno.serve(async (req) => {
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const payload: NotifyPayload = await req.json()
    const { type, capsule_id, scrapbook_id, target_user_id, actor_id, title, body, data } = payload

    let tokens: { user_id: string; push_token: string; display_name: string }[] = []

    // Get recipient tokens based on notification type
    if (target_user_id) {
      // Direct-to-user notification (like, comment, follow, DM, space join)
      const { data: user } = await supabase
        .from('users')
        .select('id, push_token, display_name')
        .eq('id', target_user_id)
        .not('push_token', 'is', null)
        .maybeSingle()
      if (user && user.id !== actor_id && user.push_token) {
        tokens = [{ user_id: user.id, push_token: user.push_token, display_name: user.display_name ?? '' }]
      }
    } else if (capsule_id) {
      const { data: members } = await supabase
        .rpc('get_capsule_member_tokens', {
          capsule_id_input: capsule_id,
          exclude_user_id: actor_id,
        })
      tokens = members ?? []
    } else if (scrapbook_id) {
      const { data: members } = await supabase
        .rpc('get_scrapbook_member_tokens', {
          scrapbook_id_input: scrapbook_id,
          exclude_user_id: actor_id,
        })
      tokens = members ?? []
    }

    if (tokens.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: 'No recipients with push tokens' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Build Expo push messages
    const messages = tokens.map((t) => ({
      to: t.push_token,
      title,
      body,
      data: { type, capsule_id, scrapbook_id, ...data },
      sound: 'default',
      priority: 'high',
    }))

    // Send in chunks of 100 (Expo limit)
    const results = []
    for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
      const chunk = messages.slice(i, i + CHUNK_SIZE)
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          // Optional: 'Authorization': `Bearer ${Deno.env.get('EXPO_ACCESS_TOKEN')}`
        },
        body: JSON.stringify(chunk),
      })
      const json = await res.json()
      results.push(...(json.data ?? []))
    }

    // Log to notification_log table
    const logEntries = tokens.map((t) => ({
      user_id: t.user_id,
      type,
      title,
      body,
      data: { capsule_id, scrapbook_id, ...data },
      status: 'sent',
    }))
    await supabase.from('notification_log').insert(logEntries)

    return new Response(
      JSON.stringify({ sent: tokens.length, results }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
