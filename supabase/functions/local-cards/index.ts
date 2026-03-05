import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper: Get or create subscription record
async function getOrCreateSubscription(supabase: ReturnType<typeof createClient>, userId: string) {
  let { data: subscription, error } = await supabase
    .from('user_subscriptions')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error && error.code === 'PGRST116') {
    const { data: newSub, error: insertError } = await supabase
      .from('user_subscriptions')
      .insert({ user_id: userId, tier: 'free', local_cards_limit: 10 })
      .select()
      .single();

    if (insertError) throw insertError;
    subscription = newSub;
  } else if (error) {
    throw error;
  }

  return subscription;
}

// Helper: Check card limit
async function checkCardLimit(supabase: ReturnType<typeof createClient>, userId: string) {
  const subscription = await getOrCreateSubscription(supabase, userId);

  const { count, error } = await supabase
    .from('user_local_cards')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  if (error) throw error;

  return {
    limit: subscription.local_cards_limit,
    used: count || 0,
    canAdd: (count || 0) < subscription.local_cards_limit,
    tier: subscription.tier
  };
}

console.log("local-cards Edge Function loaded");

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  console.log('[local-cards]', req.method, new URL(req.url).searchParams.get('action'));

  // Get user from authorization header
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(
      JSON.stringify({ error: 'Authorization required' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);

  if (userError || !user) {
    console.error('[local-cards] Auth failed:', userError?.message);
    return new Response(
      JSON.stringify({ error: 'Invalid user token' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  try {
    switch (action) {
      case 'list': {
        // Parallel fetch: subscription + cards (was 3 sequential queries, now 2 parallel)
        const [subscription, cardsResult] = await Promise.all([
          getOrCreateSubscription(supabase, user.id),
          supabase
            .from('user_local_cards')
            .select('*')
            .eq('user_id', user.id)
            .order('sort_order', { ascending: true }),
        ]);

        if (cardsResult.error) throw cardsResult.error;

        const cards = cardsResult.data || [];

        return new Response(
          JSON.stringify({
            cards,
            subscription: {
              tier: subscription.tier,
              limit: subscription.local_cards_limit,
              used: cards.length
            }
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'add': {
        const body = await req.json();
        const limitInfo = await checkCardLimit(supabase, user.id);

        if (!limitInfo.canAdd) {
          return new Response(
            JSON.stringify({
              error: 'LIMIT_EXCEEDED',
              message: `${limitInfo.tier} tier limit (${limitInfo.limit}) exceeded`,
              limit: limitInfo.limit,
              used: limitInfo.used
            }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (!body.url || !body.link_type) {
          return new Response(
            JSON.stringify({ error: 'url and link_type are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: card, error: insertError } = await supabase
          .from('user_local_cards')
          .insert({
            user_id: user.id,
            url: body.url,
            title: body.title || null,
            thumbnail: body.thumbnail || null,
            link_type: body.link_type,
            user_note: body.user_note || '',
            metadata_title: body.metadata_title || null,
            metadata_description: body.metadata_description || null,
            metadata_image: body.metadata_image || null,
            cell_index: body.cell_index ?? -1,
            level_id: body.level_id || 'scratchpad',
            sort_order: body.sort_order ?? null
          })
          .select()
          .single();

        if (insertError) {
          if (insertError.code === '23505') {
            return new Response(
              JSON.stringify({ error: 'Card with this URL already exists' }),
              { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          throw insertError;
        }

        return new Response(
          JSON.stringify({ card }),
          { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'update': {
        const body = await req.json();
        const { id, ...updates } = body;

        if (!id) {
          return new Response(
            JSON.stringify({ error: 'Card id is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const allowedFields = [
          'title', 'thumbnail', 'user_note', 'metadata_title',
          'metadata_description', 'metadata_image', 'cell_index',
          'level_id', 'sort_order'
        ];

        const safeUpdates: Record<string, unknown> = {};
        for (const field of allowedFields) {
          if (updates[field] !== undefined) {
            safeUpdates[field] = updates[field];
          }
        }

        if (Object.keys(safeUpdates).length === 0) {
          return new Response(
            JSON.stringify({ error: 'No valid fields to update' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: card, error: updateError } = await supabase
          .from('user_local_cards')
          .update(safeUpdates)
          .eq('id', id)
          .eq('user_id', user.id)
          .select()
          .single();

        if (updateError) throw updateError;

        if (!card) {
          return new Response(
            JSON.stringify({ error: 'Card not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ card }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'delete': {
        const body = await req.json();
        const { id } = body;

        if (!id) {
          return new Response(
            JSON.stringify({ error: 'Card id is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { error: deleteError } = await supabase
          .from('user_local_cards')
          .delete()
          .eq('id', id)
          .eq('user_id', user.id);

        if (deleteError) throw deleteError;

        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'batch-move': {
        const body = await req.json();
        const { updates, inserts } = body;

        if (!Array.isArray(updates) && !Array.isArray(inserts)) {
          return new Response(
            JSON.stringify({ error: 'updates or inserts array is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const result: { updated: unknown[], inserted: unknown[] } = { updated: [], inserted: [] };

        // Process updates (existing cards position change)
        if (updates && updates.length > 0) {
          const allowedFields = ['cell_index', 'level_id', 'sort_order'];
          const updateResults = await Promise.all(updates.map(async (item: { id: string; cell_index?: number; level_id?: string; sort_order?: number }) => {
            const safeUpdates: Record<string, unknown> = {};
            for (const field of allowedFields) {
              if ((item as Record<string, unknown>)[field] !== undefined) {
                safeUpdates[field] = (item as Record<string, unknown>)[field];
              }
            }
            if (Object.keys(safeUpdates).length === 0) return null;

            const { data, error } = await supabase
              .from('user_local_cards')
              .update(safeUpdates)
              .eq('id', item.id)
              .eq('user_id', user.id)
              .select()
              .single();

            if (error) {
              console.error('[local-cards] batch-move update error:', error);
              return null;
            }
            return data;
          }));
          result.updated = updateResults.filter(Boolean);
        }

        // Process inserts (pending cards → persist)
        if (inserts && inserts.length > 0) {
          // Check limit for inserts
          const limitInfo = await checkCardLimit(supabase, user.id);
          if (limitInfo.used + inserts.length > limitInfo.limit) {
            return new Response(
              JSON.stringify({
                error: 'LIMIT_EXCEEDED',
                message: `${limitInfo.tier} tier limit (${limitInfo.limit}) would be exceeded`,
                limit: limitInfo.limit,
                used: limitInfo.used
              }),
              { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          const rows = inserts.map((item: { url: string; title?: string; thumbnail?: string; link_type?: string; user_note?: string; cell_index?: number; level_id?: string; sort_order?: number }) => ({
            user_id: user.id,
            url: item.url,
            title: item.title || null,
            thumbnail: item.thumbnail || null,
            link_type: item.link_type || 'other',
            user_note: item.user_note || '',
            cell_index: item.cell_index ?? -1,
            level_id: item.level_id || 'scratchpad',
            sort_order: item.sort_order ?? null,
          }));

          const { data: insertedCards, error: insertError } = await supabase
            .from('user_local_cards')
            .insert(rows)
            .select();

          if (insertError) {
            console.error('[local-cards] batch-move insert error:', insertError);
            throw insertError;
          }
          result.inserted = insertedCards || [];
        }

        return new Response(
          JSON.stringify(result),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action. Use: list, add, update, delete, batch-move' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[local-cards] Error:', errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
