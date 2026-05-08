// One-time setup: downloads dictionaries the app needs at runtime.
// Outputs land in resources/, which is gitignored.
//
// S6 will populate this with the JMdict download + SQLite build.
//
// Run: npm run setup

async function main(): Promise<void> {
  console.log('setup is currently a no-op — JMdict download arrives in S6.')
}

main().catch((err) => {
  console.error('setup failed:', err)
  process.exit(1)
})
