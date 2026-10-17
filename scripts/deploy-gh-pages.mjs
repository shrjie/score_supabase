// 一鍵部署到 GitHub Pages（gh-pages 分支）
// 用法：npm run deploy:gh
// 會以 VITE_BASE_PATH=/<repo名稱>/ 建置，並把 dist 強制推送到 gh-pages 分支。
import { execSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sh = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' })
const remote = execSync('git remote get-url origin', { cwd: root }).toString().trim()
const [owner, repoName] = remote.replace(/^git@github\.com:/, 'https://github.com/')
  .replace(/\.git$/, '').split('/github.com/')[1].split('/')
const base = `/${repoName}/`

console.log(`→ 建置（base=${base}）`)
process.env.VITE_BASE_PATH = base
sh(`npm run build`)

const tmp = join(root, '.deploy-gh')
rmSync(tmp, { recursive: true, force: true })
mkdirSync(tmp, { recursive: true })
cpSync(join(root, 'dist'), tmp, { recursive: true })

const run = (cmd) => execSync(cmd, { cwd: tmp, stdio: 'inherit' })
run('git init -q -b gh-pages')
run('git add -A')
run('git -c user.name="github-actions[bot]" -c user.email="actions@github.com" commit -q -m "deploy: GitHub Pages"')
run(`git push -q --force ${remote} gh-pages:gh-pages`)
rmSync(tmp, { recursive: true, force: true })

console.log(`\n✅ 已推送 gh-pages：https://${owner}.github.io/${repoName}/`)
