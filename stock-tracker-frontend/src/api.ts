const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'
const DEV_USER_ID = import.meta.env.VITE_DEV_USER_ID || 'dev-user'

export async function getPortfolioSummary() {
  const response = await fetch(`${API_BASE_URL}/api/stocks/portfolio/summary`, {
    headers: {
      'x-user-id': DEV_USER_ID,
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to load portfolio summary (${response.status})`)
  }

  return response.json()
}
