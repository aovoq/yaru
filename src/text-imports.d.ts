// css.tsx が `with { type: "text" }` で文字列として読み込む tailwindcss の CSS
declare module "tailwindcss/index.css" {
  const content: string
  export default content
}
