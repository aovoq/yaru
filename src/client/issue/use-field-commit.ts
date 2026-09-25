import { useCallback, useEffect, useState } from "preact/hooks"

// 属性を 1 つずつ保存し、失敗したらその属性の行に理由を出すための入口
// save は保存の処理。失敗したら Error で断る約束にする (値を保存済みの値へ戻すのは save の側が受け持つ)
// 板の上の知らせではなく変えた行のすぐ隣に理由を出す。どの属性が保存されなかったのかを探させないため
// 別の issue に移ったら、前の issue の理由は消す

export type FieldErrors = Partial<Record<string, string>>

export function useFieldCommit<Field extends string>(
  issueId: string,
): {
  errors: FieldErrors
  run: (field: Field, save: () => Promise<void>) => Promise<void>
} {
  const [errors, setErrors] = useState<FieldErrors>({})
  useEffect(() => setErrors({}), [issueId])
  const run = useCallback(async (field: Field, save: () => Promise<void>) => {
    setErrors((current) => withoutField(current, field))
    try {
      await save()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setErrors((current) => ({ ...current, [field]: message }))
    }
  }, [])
  return { errors, run }
}

function withoutField(errors: FieldErrors, field: string): FieldErrors {
  if (!(field in errors)) return errors
  const next = { ...errors }
  delete next[field]
  return next
}
