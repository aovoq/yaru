/** @jsxImportSource hono/jsx/dom */

import { render } from "hono/jsx/dom"
import { BoardPage, type BoardPageProps } from "./app"

const initialState = document.getElementById("yaru-initial-state")

if (!initialState) {
  throw new Error("initial state element mismatch: expected #yaru-initial-state, actual missing")
}

const root = document.getElementById("root")
if (!root) {
  throw new Error("render target mismatch: expected #root, actual missing")
}

render(<BoardPage {...(JSON.parse(initialState.textContent || "") as BoardPageProps)} />, root)
