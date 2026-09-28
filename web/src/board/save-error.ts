// サーバーが入力を受け付けなかったこと。届かなかった失敗とは分けて、項目を戻す (src/client/use-page-controller.ts)
// https://www.rfc-editor.org/rfc/rfc9110#section-15.5
export class SaveRejectedError extends Error {}
