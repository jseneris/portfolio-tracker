import { Auth0Provider, useAuth0 } from '@auth0/auth0-react'
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'

type AppAuthContextValue = {
  isConfigured: boolean
  isLoading: boolean
  isAuthenticated: boolean
  userName: string | null
  userEmail: string | null
  login: () => Promise<void>
  logout: () => void
}

type AccessTokenGetter = (() => Promise<string | null>) | null

const auth0Domain = import.meta.env.VITE_AUTH0_DOMAIN?.trim() ?? ''
const auth0ClientId = import.meta.env.VITE_AUTH0_CLIENT_ID?.trim() ?? ''
const auth0Audience = import.meta.env.VITE_AUTH0_AUDIENCE?.trim() ?? ''
const auth0RedirectUri = import.meta.env.VITE_AUTH0_REDIRECT_URI?.trim() || window.location.origin

const isAuth0Configured = Boolean(auth0Domain && auth0ClientId)

let accessTokenGetter: AccessTokenGetter = null

export function setAccessTokenGetter(getter: AccessTokenGetter) {
  accessTokenGetter = getter
}

export async function getRequestHeaders(): Promise<Record<string, string>> {
  if (!isAuth0Configured) {
    return {
      'x-user-id': import.meta.env.VITE_DEV_USER_ID || 'dev-user',
    }
  }

  const token = await accessTokenGetter?.()
  if (!token) {
    return {}
  }

  return {
    Authorization: `Bearer ${token}`,
  }
}

const AppAuthContext = createContext<AppAuthContextValue | null>(null)

function DevAuthProvider({ children }: { children: ReactNode }) {
  const value = useMemo<AppAuthContextValue>(() => ({
    isConfigured: false,
    isLoading: false,
    isAuthenticated: true,
    userName: import.meta.env.VITE_DEV_USER_ID || 'dev-user',
    userEmail: null,
    login: async () => {},
    logout: () => {},
  }), [])

  return <AppAuthContext.Provider value={value}>{children}</AppAuthContext.Provider>
}

function Auth0Bridge({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, loginWithRedirect, logout, getAccessTokenSilently, user } = useAuth0()

  useEffect(() => {
    if (!isAuthenticated) {
      setAccessTokenGetter(async () => null)
      return
    }

    setAccessTokenGetter(async () => {
      try {
        return await getAccessTokenSilently({
          authorizationParams: auth0Audience ? { audience: auth0Audience } : undefined,
        })
      } catch {
        return null
      }
    })

    return () => setAccessTokenGetter(null)
  }, [getAccessTokenSilently, isAuthenticated])

  const value = useMemo<AppAuthContextValue>(() => ({
    isConfigured: true,
    isLoading,
    isAuthenticated,
    userName: user?.name || user?.nickname || null,
    userEmail: user?.email || null,
    login: async () => {
      await loginWithRedirect()
    },
    logout: () => {
      setAccessTokenGetter(null)
      logout({ logoutParams: { returnTo: window.location.origin } })
    },
  }), [isAuthenticated, isLoading, loginWithRedirect, logout, user?.email, user?.name, user?.nickname])

  return <AppAuthContext.Provider value={value}>{children}</AppAuthContext.Provider>
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!isAuth0Configured) {
    return <DevAuthProvider>{children}</DevAuthProvider>
  }

  return (
    <Auth0Provider
      domain={auth0Domain}
      clientId={auth0ClientId}
      authorizationParams={{
        redirect_uri: auth0RedirectUri,
        ...(auth0Audience ? { audience: auth0Audience } : {}),
      }}
      onRedirectCallback={() => {
        window.history.replaceState({}, document.title, window.location.pathname + window.location.search)
      }}
    >
      <Auth0Bridge>{children}</Auth0Bridge>
    </Auth0Provider>
  )
}

export function useAppAuth(): AppAuthContextValue {
  const context = useContext(AppAuthContext)
  if (!context) {
    throw new Error('useAppAuth must be used within AuthProvider')
  }

  return context
}