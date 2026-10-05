import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

const pageSize = 1000
const longBanDuration = '876000h'

type FunctionRequest = Record<string, unknown>
type ClientProfile = {
  id: string
  display_name: string
  role: 'admin' | 'client'
  is_active: boolean
  created_at: string
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  })
}

function isRequestBody(value: unknown): value is FunctionRequest {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Método no permitido.' }, 405)
  }

  const authorization = request.headers.get('Authorization')
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) {
    return jsonResponse({ error: 'Se requiere una sesión válida.' }, 401)
  }

  let body: FunctionRequest
  try {
    const parsed: unknown = await request.json()
    if (!isRequestBody(parsed)) {
      return jsonResponse({ error: 'La solicitud no es válida.' }, 400)
    }
    body = parsed
  } catch {
    return jsonResponse({ error: 'El cuerpo JSON no es válido.' }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error('Missing Supabase environment for manage-users function.')
    return jsonResponse(
      { error: 'El servicio de administración no está configurado.' },
      500,
    )
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
  const privilegedClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })

  try {
    const { data: authData, error: authError } =
      await authClient.auth.getUser(token)
    if (authError || !authData.user) {
      return jsonResponse({ error: 'La sesión no es válida.' }, 401)
    }

    const { data: actorProfile, error: actorProfileError } =
      await privilegedClient
        .from('profiles')
        .select('role, is_active')
        .eq('id', authData.user.id)
        .maybeSingle()

    if (actorProfileError) {
      console.error('Could not verify administrator role:', actorProfileError)
      return jsonResponse(
        { error: 'No fue posible verificar los permisos de administrador.' },
        500,
      )
    }

    if (
      !actorProfile ||
      actorProfile.role !== 'admin' ||
      actorProfile.is_active !== true
    ) {
      return jsonResponse(
        { error: 'Esta acción requiere una cuenta de administrador activa.' },
        403,
      )
    }

    if (body.action === 'list') {
      const { data: profileData, error: profilesError } =
        await privilegedClient
          .from('profiles')
          .select('id, display_name, role, is_active, created_at')
          .eq('role', 'client')
          .order('created_at', { ascending: false })

      if (profilesError) {
        console.error('Could not list client profiles:', profilesError)
        return jsonResponse(
          { error: 'No fue posible cargar la lista de clientes.' },
          500,
        )
      }

      const profiles = (profileData ?? []) as ClientProfile[]
      const authUsers = []
      for (let page = 1; ; page += 1) {
        const { data, error } = await privilegedClient.auth.admin.listUsers({
          page,
          perPage: pageSize,
        })

        if (error) {
          console.error('Could not list authenticated users:', error)
          return jsonResponse(
            { error: 'No fue posible cargar las cuentas de usuario.' },
            502,
          )
        }

        authUsers.push(...data.users)
        if (data.users.length < pageSize) break
      }

      const usersById = new Map(authUsers.map((authUser) => [authUser.id, authUser]))
      const clients = profiles.flatMap((profile) => {
        const authUser = usersById.get(profile.id)
        if (!authUser) return []

        const hasActiveBan =
          authUser.banned_until !== undefined &&
          authUser.banned_until !== null &&
          Date.parse(authUser.banned_until) > Date.now()

        return [
          {
            id: profile.id,
            email: authUser.email ?? '',
            display_name: profile.display_name,
            is_active: profile.is_active && !hasActiveBan,
            created_at: profile.created_at,
          },
        ]
      })

      return jsonResponse({ clients })
    }

    if (
      body.action !== 'set-status' ||
      typeof body.userId !== 'string' ||
      typeof body.isActive !== 'boolean'
    ) {
      return jsonResponse({ error: 'La acción solicitada no es válida.' }, 400)
    }

    const { data: targetProfile, error: targetError } =
      await privilegedClient
        .from('profiles')
        .select('id, display_name, role, is_active, created_at')
        .eq('id', body.userId)
        .maybeSingle()

    if (targetError) {
      console.error('Could not load target profile:', targetError)
      return jsonResponse(
        { error: 'No fue posible verificar la cuenta seleccionada.' },
        500,
      )
    }
    if (!targetProfile || targetProfile.role !== 'client') {
      return jsonResponse(
        { error: 'Solo se pueden administrar cuentas de cliente.' },
        404,
      )
    }

    const requestedActiveState = body.isActive
    const { data: changedProfile, error: profileUpdateError } =
      await privilegedClient
      .from('profiles')
      .update({ is_active: requestedActiveState })
      .eq('id', targetProfile.id)
      .select('id')
      .maybeSingle()

    if (profileUpdateError || !changedProfile) {
      console.error('Could not update client profile status:', profileUpdateError)
      return jsonResponse(
        { error: 'No fue posible actualizar el estado del perfil.' },
        500,
      )
    }

    const { data: updatedAuth, error: authUpdateError } =
      await privilegedClient.auth.admin.updateUserById(targetProfile.id, {
        ban_duration: requestedActiveState ? 'none' : longBanDuration,
      })

    if (authUpdateError || !updatedAuth.user) {
      console.error('Could not synchronize Auth account status:', authUpdateError)
      return jsonResponse(
        {
          error:
            'El perfil fue actualizado, pero no se pudo sincronizar el acceso. Reintenta la acción o revisa Supabase.',
        },
        502,
      )
    }

    return jsonResponse({
      client: {
        id: targetProfile.id,
        email: updatedAuth.user.email ?? '',
        display_name: targetProfile.display_name,
        is_active: requestedActiveState,
        created_at: targetProfile.created_at,
      },
    })
  } catch (error) {
    console.error('Unexpected manage-users failure:', error)
    return jsonResponse(
      { error: 'Ocurrió un error inesperado al administrar usuarios.' },
      500,
    )
  }
})
