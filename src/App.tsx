import { useEffect, useState, type FormEvent } from 'react'
import { FunctionsHttpError, type User } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import './App.css'

type AppRole = 'admin' | 'client'
type AuthMode = 'sign-in' | 'sign-up'
type Profile = {
  id: string
  display_name: string
  role: AppRole
  is_active: boolean
  created_at: string
}
type ManagedClient = {
  id: string
  email: string
  display_name: string
  is_active: boolean
  created_at: string
}
type ManageUsersResponse = { clients: ManagedClient[] } | { client: ManagedClient }

const currentYear = new Date().getFullYear()

function App() {
  const [portal, setPortal] = useState<AppRole | null>(null)
  const [mode, setMode] = useState<AuthMode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileName, setProfileName] = useState('')
  const [clientDirectory, setClientDirectory] = useState<{
    ownerId: string
    clients: ManagedClient[]
  } | null>(null)
  const [clientListError, setClientListError] = useState('')
  const [busy, setBusy] = useState(false)
  const [busyClientId, setBusyClientId] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!supabase) return

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setProfile(null)
      setProfileName('')
      setClientDirectory(null)
      setClientListError('')
      setErrorMessage('')
    })

    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!supabase || !user) {
      return
    }

    const client = supabase
    let isCurrent = true
    const currentUser = user

    async function loadProfile() {
      const { data, error } = await client
        .from('profiles')
        .select('id, display_name, role, is_active, created_at')
        .eq('id', currentUser.id)
        .maybeSingle()

      if (!isCurrent) return

      if (error || !data) {
        setErrorMessage(
          error?.message ??
            'No encontramos el perfil de esta cuenta. Contacta al administrador.',
        )
        return
      }

      if (data.role !== 'admin' && data.role !== 'client') {
        setErrorMessage('El rol de esta cuenta no es válido.')
        return
      }

      const nextProfile: Profile = {
        id: data.id,
        display_name: data.display_name,
        role: data.role,
        is_active: data.is_active,
        created_at: data.created_at,
      }
      setProfile(nextProfile)
      setProfileName(nextProfile.display_name)
    }

    void loadProfile().catch((error: unknown) => {
      if (!isCurrent) return
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'No fue posible cargar el perfil.',
      )
    })

    return () => {
      isCurrent = false
    }
  }, [user])

  useEffect(() => {
    if (
      !supabase ||
      !user ||
      profile?.id !== user.id ||
      profile.role !== 'admin' ||
      !profile.is_active
    ) {
      return
    }

    const client = supabase
    let isCurrent = true
    const currentUser = user

    async function loadClients() {
      const { data, error } = await client.functions.invoke<ManageUsersResponse>(
        'manage-users',
        { body: { action: 'list' } },
      )

      if (error) throw error
      if (!data || !('clients' in data)) {
        throw new Error('La respuesta del servicio de usuarios no es válida.')
      }
      if (isCurrent) {
        setClientDirectory({ ownerId: currentUser.id, clients: data.clients })
        setClientListError('')
      }
    }

    void loadClients()
      .catch((error: unknown) => {
        if (isCurrent) {
          void getErrorMessage(error).then(setClientListError)
        }
      })

    return () => {
      isCurrent = false
    }
  }, [profile, user])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage('')
    setNotice('')

    if (!supabase || !portal) return

    if (mode === 'sign-up' && portal !== 'client') {
      setErrorMessage('El registro público está disponible solo para clientes.')
      return
    }
    if (mode === 'sign-up' && password !== confirmPassword) {
      setErrorMessage('Las contraseñas no coinciden.')
      return
    }

    setBusy(true)

    try {
      if (mode === 'sign-up') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        })

        if (error) {
          setErrorMessage(error.message)
          return
        }

        setPassword('')
        setConfirmPassword('')

        if (data.session) {
          setNotice('Tu cuenta de cliente se creó correctamente.')
        } else {
          setMode('sign-in')
          setNotice(
            'Revisa tu correo para confirmar la cuenta y después inicia sesión.',
          )
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })

        if (error) {
          setErrorMessage(error.message)
          return
        }

        setPassword('')
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'No fue posible completar la solicitud. Inténtalo de nuevo.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleSignOut() {
    if (!supabase) return

    setErrorMessage('')
    setBusy(true)

    try {
      const { error } = await supabase.auth.signOut()
      if (error) setErrorMessage(error.message)
      else {
        setProfile(null)
        setProfileName('')
        setPortal(null)
        setMode('sign-in')
        setNotice('')
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'No fue posible cerrar la sesión. Inténtalo de nuevo.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function saveClientProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage('')
    setNotice('')

    const displayName = profileName.trim()
    if (!supabase || !profile || !displayName) {
      setErrorMessage('Escribe un nombre para guardar tu perfil.')
      return
    }

    setBusy(true)

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ display_name: displayName })
        .eq('id', profile.id)

      if (error) {
        setErrorMessage(error.message)
        return
      }

      setProfile({ ...profile, display_name: displayName })
      setNotice('Tu perfil se guardó correctamente.')
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'No fue posible guardar tu perfil.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function changeClientStatus(client: ManagedClient) {
    if (!supabase) return

    setErrorMessage('')
    setNotice('')
    setBusyClientId(client.id)

    try {
      const { data, error } = await supabase.functions.invoke<ManageUsersResponse>(
        'manage-users',
        {
          body: {
            action: 'set-status',
            userId: client.id,
            isActive: !client.is_active,
          },
        },
      )

      if (error) throw error
      if (!data || !('client' in data)) {
        throw new Error('La respuesta del servicio de usuarios no es válida.')
      }

      setClientDirectory((current) =>
        current && current.ownerId === user?.id
          ? {
              ...current,
              clients: current.clients.map((item) =>
                item.id === client.id ? data.client : item,
              ),
            }
          : current,
      )
      setNotice(
        data.client.is_active
          ? 'La cuenta del cliente quedó activa.'
          : 'La cuenta del cliente quedó desactivada.',
      )
    } catch (error) {
      setErrorMessage(await getErrorMessage(error))
    } finally {
      setBusyClientId('')
    }
  }

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode)
    setErrorMessage('')
    setNotice('')
    setPassword('')
    setConfirmPassword('')
  }

  function selectPortal(nextPortal: AppRole) {
    setPortal(nextPortal)
    setMode('sign-in')
    setErrorMessage('')
    setNotice('')
    setPassword('')
    setConfirmPassword('')
  }

  const signedIn = Boolean(user)
  const currentProfile =
    user && profile?.id === user.id ? profile : null
  const profileLoading = Boolean(user && !currentProfile && !errorMessage)
  const profileReady = Boolean(currentProfile?.is_active)
  const portalMismatch = Boolean(
    currentProfile && portal && currentProfile.role !== portal,
  )
  const clients =
    user && clientDirectory?.ownerId === user.id
      ? clientDirectory.clients
      : []
  const clientsLoading = Boolean(
    currentProfile?.role === 'admin' &&
      currentProfile.is_active &&
      clientDirectory?.ownerId !== user?.id &&
      !clientListError,
  )

  return (
    <main className="auth-shell">
      <section className="brand-panel" aria-label="Acerca de Nexo">
        <a className="brand" href="/" aria-label="Nexo, inicio">
          <span className="brand-mark" aria-hidden="true">
            n
          </span>
          <span>nexo</span>
        </a>

        <div className="brand-copy">
          <p className="eyebrow">TU ESPACIO, EN UN SOLO LUGAR</p>
          <h1>Todo empieza con una buena conexión.</h1>
          <p className="brand-description">
            Un espacio seguro para entrar, crear y seguir adelante.
          </p>
        </div>

        <div className="panel-note">
          <span className="status-dot" aria-hidden="true" />
          <span>Un espacio diseñado para ti</span>
        </div>
        <div className="orbit orbit-one" aria-hidden="true" />
        <div className="orbit orbit-two" aria-hidden="true" />
      </section>

      <section className="form-panel">
        <div className="mobile-brand" aria-hidden="true">
          <span className="brand-mark">n</span>
          <span>nexo</span>
        </div>

        <div className="auth-card">
          {!signedIn && !portal ? (
            <PortalChooser onSelect={selectPortal} />
          ) : null}

          {!signedIn && portal ? (
            <section aria-labelledby="auth-title">
              <button
                className="back-link"
                type="button"
                onClick={() => setPortal(null)}
              >
                ← Cambiar de portal
              </button>
              <p className="eyebrow">
                {portal === 'admin' ? 'ACCESO ADMINISTRADOR' : 'PORTAL DE CLIENTES'}
              </p>
              <h2 id="auth-title">
                {mode === 'sign-in'
                  ? portal === 'admin'
                    ? 'Acceso de administrador'
                    : 'Inicia sesión'
                  : 'Crea tu cuenta'}
              </h2>
              <p className="form-description">
                {mode === 'sign-up'
                  ? 'El registro público crea una cuenta de cliente.'
                  : portal === 'admin'
                    ? 'Usa la cuenta que el administrador del sistema te asignó.'
                    : 'Ingresa tus datos para entrar a tu espacio.'}
              </p>

              {!isSupabaseConfigured && <SupabaseSetupNotice />}

              <form onSubmit={handleSubmit}>
                <label className="field">
                  <span>Correo electrónico</span>
                  <input
                    type="email"
                    name="email"
                    autoComplete="email"
                    placeholder="tu@correo.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    disabled={!isSupabaseConfigured || busy}
                  />
                </label>

                <label className="field">
                  <span>Contraseña</span>
                  <input
                    type="password"
                    name="password"
                    autoComplete={
                      mode === 'sign-in' ? 'current-password' : 'new-password'
                    }
                    placeholder="Mínimo 8 caracteres"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    minLength={8}
                    required
                    disabled={!isSupabaseConfigured || busy}
                  />
                </label>

                {mode === 'sign-up' && (
                  <label className="field">
                    <span>Confirma tu contraseña</span>
                    <input
                      type="password"
                      name="confirm-password"
                      autoComplete="new-password"
                      placeholder="Escríbela nuevamente"
                      value={confirmPassword}
                      onChange={(event) =>
                        setConfirmPassword(event.target.value)
                      }
                      minLength={8}
                      required
                      disabled={!isSupabaseConfigured || busy}
                    />
                  </label>
                )}

                {errorMessage && <Feedback kind="error">{errorMessage}</Feedback>}
                {notice && <Feedback kind="success">{notice}</Feedback>}

                <button
                  className="primary-button"
                  type="submit"
                  disabled={!isSupabaseConfigured || busy}
                >
                  {busy
                    ? 'Un momento…'
                    : mode === 'sign-in'
                      ? 'Entrar a mi cuenta'
                      : 'Crear cuenta'}
                  {!busy && <span aria-hidden="true">→</span>}
                </button>
              </form>

              {portal === 'client' && (
                <p className="mode-switch">
                  {mode === 'sign-in'
                    ? '¿Aún no tienes cuenta?'
                    : '¿Ya tienes cuenta?'}
                  <button
                    type="button"
                    onClick={() =>
                      switchMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')
                    }
                  >
                    {mode === 'sign-in' ? 'Regístrate' : 'Inicia sesión'}
                  </button>
                </p>
              )}
            </section>
          ) : null}

          {signedIn && profileLoading ? (
            <div className="state-card" role="status">
              <span className="loading-indicator" aria-hidden="true" />
              <h2>Verificando tu acceso…</h2>
              <p className="form-description">
                Estamos comprobando tu perfil y tus permisos.
              </p>
            </div>
          ) : null}

          {signedIn && !profileLoading && errorMessage && !profile ? (
            <div className="state-card">
              <p className="eyebrow">NO SE PUDO VALIDAR EL ACCESO</p>
              <h2>Revisa tu cuenta</h2>
              <Feedback kind="error">{errorMessage}</Feedback>
              <button
                className="primary-button"
                type="button"
                onClick={handleSignOut}
                disabled={busy}
              >
                Cerrar sesión
              </button>
            </div>
          ) : null}

          {signedIn && currentProfile && !currentProfile.is_active ? (
            <div className="state-card">
              <p className="eyebrow">CUENTA DESACTIVADA</p>
              <h2>Acceso pausado</h2>
              <p className="form-description">
                Esta cuenta fue desactivada. Contacta al administrador si
                necesitas recuperar el acceso.
              </p>
              <button
                className="primary-button"
                type="button"
                onClick={handleSignOut}
                disabled={busy}
              >
                Cerrar sesión
              </button>
            </div>
          ) : null}

          {signedIn && profileReady && portalMismatch ? (
            <div className="state-card">
              <p className="eyebrow">PORTAL INCORRECTO</p>
              <h2>Este acceso no corresponde a tu rol</h2>
              <p className="form-description">
                Esta cuenta tiene el rol de{' '}
                <strong>
                  {currentProfile?.role === 'admin' ? 'administrador' : 'cliente'}
                </strong>
                . Cierra sesión para elegir el portal correcto.
              </p>
              <button
                className="primary-button"
                type="button"
                onClick={handleSignOut}
                disabled={busy}
              >
                Cerrar sesión
              </button>
            </div>
          ) : null}

          {signedIn &&
          profileReady &&
          !portalMismatch &&
          currentProfile?.role === 'client' ? (
            <ClientDashboard
              user={user}
              profile={currentProfile}
              profileName={profileName}
              setProfileName={setProfileName}
              busy={busy}
              errorMessage={errorMessage}
              notice={notice}
              onSave={saveClientProfile}
              onSignOut={handleSignOut}
            />
          ) : null}

          {signedIn &&
          profileReady &&
          !portalMismatch &&
          currentProfile?.role === 'admin' ? (
            <AdminDashboard
              email={user?.email ?? ''}
              clients={clients}
              isLoading={clientsLoading}
              busyClientId={busyClientId}
              errorMessage={clientListError || errorMessage}
              notice={notice}
              onChangeStatus={changeClientStatus}
              onSignOut={handleSignOut}
            />
          ) : null}
        </div>

        <footer className="form-footer">
          <span>© {currentYear} Nexo</span>
          <span>Acceso seguro</span>
        </footer>
      </section>
    </main>
  )
}

function PortalChooser({ onSelect }: { onSelect: (role: AppRole) => void }) {
  return (
    <section aria-labelledby="portal-title">
      <p className="eyebrow">BIENVENIDO A NEXO</p>
      <h2 id="portal-title">Elige tu espacio</h2>
      <p className="form-description">
        Selecciona el portal para continuar con tu cuenta.
      </p>
      <div className="portal-options">
        <button
          className="portal-option"
          type="button"
          onClick={() => onSelect('admin')}
        >
          <span className="portal-icon" aria-hidden="true">
            A
          </span>
          <span className="portal-option-copy">
            <strong>Administrador</strong>
            <span>Gestiona clientes y accesos</span>
          </span>
          <span className="portal-arrow" aria-hidden="true">
            →
          </span>
        </button>
        <button
          className="portal-option"
          type="button"
          onClick={() => onSelect('client')}
        >
          <span className="portal-icon portal-icon-client" aria-hidden="true">
            C
          </span>
          <span className="portal-option-copy">
            <strong>Cliente</strong>
            <span>Entra a tu espacio personal</span>
          </span>
          <span className="portal-arrow" aria-hidden="true">
            →
          </span>
        </button>
      </div>
      {!isSupabaseConfigured && <SupabaseSetupNotice />}
    </section>
  )
}

function ClientDashboard({
  user,
  profile,
  profileName,
  setProfileName,
  busy,
  errorMessage,
  notice,
  onSave,
  onSignOut,
}: {
  user: User | null
  profile: Profile
  profileName: string
  setProfileName: (name: string) => void
  busy: boolean
  errorMessage: string
  notice: string
  onSave: (event: FormEvent<HTMLFormElement>) => void
  onSignOut: () => void
}) {
  return (
    <section className="dashboard" aria-labelledby="client-title">
      <DashboardHeader
        eyebrow="PORTAL DE CLIENTES"
        email={user?.email ?? ''}
        onSignOut={onSignOut}
      />
      <p className="eyebrow">TU ESPACIO PERSONAL</p>
      <h2 id="client-title">
        {profile.display_name
          ? `Hola, ${profile.display_name}`
          : 'Completa tu perfil'}
      </h2>
      <p className="form-description">
        Mantén actualizada la información básica de tu cuenta.
      </p>
      <form onSubmit={onSave}>
        <label className="field">
          <span>Nombre para mostrar</span>
          <input
            type="text"
            name="display-name"
            autoComplete="name"
            maxLength={80}
            placeholder="¿Cómo te llamamos?"
            value={profileName}
            onChange={(event) => setProfileName(event.target.value)}
            required
            disabled={busy}
          />
        </label>
        <label className="field">
          <span>Correo electrónico</span>
          <input type="email" value={user?.email ?? ''} readOnly />
        </label>
        {errorMessage && <Feedback kind="error">{errorMessage}</Feedback>}
        {notice && <Feedback kind="success">{notice}</Feedback>}
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar perfil'}
        </button>
      </form>
    </section>
  )
}

function AdminDashboard({
  email,
  clients,
  isLoading,
  busyClientId,
  errorMessage,
  notice,
  onChangeStatus,
  onSignOut,
}: {
  email: string
  clients: ManagedClient[]
  isLoading: boolean
  busyClientId: string
  errorMessage: string
  notice: string
  onChangeStatus: (client: ManagedClient) => void
  onSignOut: () => void
}) {
  return (
    <section className="dashboard admin-dashboard" aria-labelledby="admin-title">
      <DashboardHeader
        eyebrow="PORTAL DE ADMINISTRACIÓN"
        email={email}
        onSignOut={onSignOut}
      />
      <p className="eyebrow">GESTIÓN DE ACCESOS</p>
      <h2 id="admin-title">Clientes</h2>
      <p className="form-description">
        Consulta perfiles y administra el acceso al portal de clientes.
      </p>
      {errorMessage && <Feedback kind="error">{errorMessage}</Feedback>}
      {notice && <Feedback kind="success">{notice}</Feedback>}
      {isLoading ? (
        <p className="table-message" role="status">
          Cargando clientes…
        </p>
      ) : clients.length === 0 ? (
        <p className="table-message">Todavía no hay clientes registrados.</p>
      ) : (
        <div className="client-list" role="list" aria-label="Lista de clientes">
          {clients.map((client) => (
            <article className="client-row" key={client.id} role="listitem">
              <div className="client-avatar" aria-hidden="true">
                {(client.display_name || client.email || 'C')
                  .charAt(0)
                  .toUpperCase()}
              </div>
              <div className="client-info">
                <strong>{client.display_name || 'Sin nombre'}</strong>
                <span>{client.email}</span>
                <span
                  className={`account-status ${client.is_active ? 'is-active' : 'is-inactive'}`}
                >
                  {client.is_active ? 'Activa' : 'Desactivada'}
                </span>
              </div>
              <button
                className={`status-button ${client.is_active ? 'deactivate-button' : 'activate-button'}`}
                type="button"
                onClick={() => onChangeStatus(client)}
                disabled={Boolean(busyClientId)}
              >
                {busyClientId === client.id
                  ? 'Actualizando…'
                  : client.is_active
                    ? 'Desactivar'
                    : 'Activar'}
              </button>
            </article>
          ))}
        </div>
      )}
      <p className="admin-note">
        La asignación del rol Administrador se realiza de forma segura desde
        Supabase.
      </p>
    </section>
  )
}

function DashboardHeader({
  eyebrow,
  email,
  onSignOut,
}: {
  eyebrow: string
  email: string
  onSignOut: () => void
}) {
  return (
    <header className="dashboard-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <span className="dashboard-email">{email}</span>
      </div>
      <button className="sign-out-button" type="button" onClick={onSignOut}>
        Salir
      </button>
    </header>
  )
}

function SupabaseSetupNotice() {
  return (
    <div className="setup-message" role="status">
      <strong>Falta conectar Supabase.</strong>
      <span>
        Copia <code>.env.example</code> a <code>.env.local</code> y configura
        los datos de tu proyecto. Consulta el README para completar la
        migración y la función segura de administración.
      </span>
    </div>
  )
}

function Feedback({
  kind,
  children,
}: {
  kind: 'error' | 'success'
  children: string
}) {
  return (
    <p
      className={`feedback feedback-${kind}`}
      role={kind === 'error' ? 'alert' : 'status'}
    >
      {children}
    </p>
  )
}

async function getErrorMessage(error: unknown) {
  if (error instanceof FunctionsHttpError && error.context instanceof Response) {
    try {
      const payload: unknown = await error.context.clone().json()
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'error' in payload &&
        typeof payload.error === 'string'
      ) {
        return payload.error
      }
    } catch {
      return error.message
    }
  }

  return error instanceof Error
    ? error.message
    : 'No fue posible completar la solicitud.'
}

export default App
