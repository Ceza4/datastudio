// Persistent headed-less Chromium on CDP :9333 so step scripts can share one live page.
import { createRequire } from 'node:module'
const require = createRequire('/opt/npm-tools/node_modules/')
const { chromium } = require('playwright')
import { sessionCookie } from './lib.mjs'
export async function attach() {
  const browser = await chromium.connectOverCDP('http://localhost:9333')
  let context = browser.contexts()[0]
  let page = context.pages()[0]
  if (!page) page = await context.newPage()
  return { browser, context, page }
}
