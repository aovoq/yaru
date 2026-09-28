import { expect, test } from "vitest"
import { installTestDom } from "../test-dom"
import { copyText } from "./copy-text"

const testWindow = installTestDom()
const page = testWindow as unknown as Window

test("copy uses the clipboard on a secure page", async () => {
  let written = ""
  Object.defineProperty(page, "isSecureContext", { configurable: true, value: true })
  Object.defineProperty(page.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        written = text
      },
    },
  })
  expect(await copyText("pane text")).toBe(true)
  expect(written).toBe("pane text")
})

test("copy falls back to execCommand when the clipboard rejects", async () => {
  Object.defineProperty(page, "isSecureContext", { configurable: true, value: true })
  Object.defineProperty(page.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async () => {
        throw new Error("denied")
      },
    },
  })
  let command = ""
  page.document.execCommand = ((name: string) => {
    command = name
    return true
  }) as typeof document.execCommand
  expect(await copyText("fallback")).toBe(true)
  expect(command).toBe("copy")
  expect(page.document.querySelector("textarea")).toBeNull()
})

test("copy reports failure when execCommand cannot copy", async () => {
  Object.defineProperty(page, "isSecureContext", { configurable: true, value: false })
  page.document.execCommand = (() => false) as typeof document.execCommand
  expect(await copyText("nope")).toBe(false)
})
