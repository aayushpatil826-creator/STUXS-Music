// Supabase Edge Function Shared Module: developerGuard.ts
// Secure Server-Side Authorization Boundary for STUXS Music Developer Operations

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

export interface DeveloperAuthResult {
  isAuthorized: boolean;
  userId?: string;
  errorResponse?: Response;
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

/**
 * Verifies that the incoming HTTP request is authenticated and belongs to a user
 * with the verified 'developer' role in the database.
 *
 * Checks:
 * 1. Valid Authorization Bearer header
 * 2. Valid authenticated user session via supabase.auth.getUser()
 * 3. Server-side role check in public.profiles table (or public.is_developer function)
 */
export async function requireDeveloperAuth(req: Request): Promise<DeveloperAuthResult> {
  if (req.method === "OPTIONS") {
    return {
      isAuthorized: false,
      errorResponse: new Response("ok", { headers: corsHeaders }),
    };
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return {
      isAuthorized: false,
      errorResponse: new Response(
        JSON.stringify({ error: "Unauthorized: Missing Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      ),
    };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  // 1. Authenticate user JWT
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return {
      isAuthorized: false,
      errorResponse: new Response(
        JSON.stringify({ error: "Unauthorized: Invalid or expired authentication session" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      ),
    };
  }

  // 2. Query verified role using service_role client to guarantee authority
  const adminClient = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey);
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profileError || !profile || profile.role !== "developer") {
    return {
      isAuthorized: false,
      errorResponse: new Response(
        JSON.stringify({
          error: "Forbidden: Developer permissions required. This account does not have developer privileges.",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      ),
    };
  }

  return {
    isAuthorized: true,
    userId: user.id,
  };
}
