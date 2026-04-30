import fs from 'node:fs'
import path from 'node:path'

interface Wallet {
  address: `0x${string}`
  privateKey: `0x${string}`
}

const requireWalletJsonPath = () => {
  return path.resolve(process.cwd(), 'wallet.json')
}

const readWalletJson = (walletJsonPath: string): Wallet => {
  return JSON.parse(fs.readFileSync(walletJsonPath, 'utf-8'))
}

const writeWalletJson = (walletJsonPath: string, wallet: Wallet) => {
  fs.writeFileSync(walletJsonPath, JSON.stringify(wallet, null, 2))
}

const requireWallet = (): { walletJsonPath: string; wallet: Wallet } => {
  const walletJsonPath = requireWalletJsonPath()
  if (!fs.existsSync(walletJsonPath)) {
    console.error('No wallet found. Run `mtspaw wallet create` first.')
    process.exit(1)
  }
  const wallet = readWalletJson(walletJsonPath)
  if (!wallet?.address || !wallet?.privateKey) {
    console.error('wallet.json is missing address or privateKey. Run `mtspaw wallet create --force` to recreate.')
    process.exit(1)
  }
  return { walletJsonPath, wallet }
}

export { readWalletJson, requireWallet, requireWalletJsonPath, writeWalletJson }
export type { Wallet }
