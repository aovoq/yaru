import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks"
import { Combobox } from "../../components/combobox"
import { clampMenuPosition, type PropertyPicker as PropertyPickerData } from "../issue-menu"
import { MenuIconView } from "./menu-icon"

// s / p / a / l / d と「…」のボタンから開く、issue の属性の選択の面。押した行やボタンの左下に浮かせ、中に共通の Combobox を置く
// 右クリックのメニューと同じく、外を押す・画面を動かす・ウィンドウを離れると閉じる
// Esc か選んで閉じたときは、開く前に focus のあった場所へ戻す。外を押して閉じたときは押した先に focus が移るので戻さない
// https://www.w3.org/WAI/ARIA/apg/patterns/combobox/

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// 開いた元との間の隙間
const GAP = 4

export function PropertyPicker({
  picker,
  anchor,
  returnFocus,
  onSelect,
  onCreate,
  onClose,
}: {
  picker: PropertyPickerData
  // 開いた元 (行やボタン) の位置。下に収まればその下に、収まらなければ上に開く
  anchor: { left: number; top: number; bottom: number }
  returnFocus?: HTMLElement | null
  onSelect: (value: string) => void
  onCreate?: (query: string) => void
  onClose: () => void
}) {
  const panel = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ x: anchor.left, y: anchor.bottom + GAP })

  // 描いてから大きさを測り、下に収まらなければ上に開き、画面の端からはみ出さない位置に置き直す
  // 下の帯 (まとめて変える帯) のボタンから開いたときに、帯と指の上に重ならないようにするため
  useLayoutEffect(() => {
    const element = panel.current
    if (!element) return
    const size = { width: element.offsetWidth, height: element.offsetHeight }
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const fitsBelow = anchor.bottom + GAP + size.height <= viewport.height - GAP
    const y = fitsBelow ? anchor.bottom + GAP : anchor.top - GAP - size.height
    setPosition(clampMenuPosition({ x: anchor.left, y }, size, viewport))
  }, [anchor.left, anchor.top, anchor.bottom])

  useEffect(() => {
    const inside = (target: EventTarget | null) =>
      target instanceof Node && panel.current?.contains(target) === true
    const onPointerDown = (event: PointerEvent) => {
      if (!inside(event.target)) onClose()
    }
    // 候補の一覧を送る scroll (Combobox が選んだ候補を見える位置まで送るときも) では閉じない
    const onScroll = (event: Event) => {
      if (!inside(event.target)) onClose()
    }
    const close = () => onClose()
    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("scroll", onScroll, true)
    window.addEventListener("resize", close)
    window.addEventListener("blur", close)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("scroll", onScroll, true)
      window.removeEventListener("resize", close)
      window.removeEventListener("blur", close)
    }
  }, [onClose])

  const closeAndReturn = () => {
    onClose()
    returnFocus?.focus({ preventScroll: true })
  }

  const isDate = picker.field === "dueDate"
  return (
    <div
      ref={panel}
      data-property-picker=""
      style={`left: ${position.x}px; top: ${position.y}px`}
      class="text-body fixed z-50 min-w-52 rounded-xl border border-hairline-strong bg-surface-3 p-1 shadow-2xl shadow-black/60"
    >
      <Combobox
        label={picker.label}
        placeholder={isDate ? "Today, or YYYY-MM-DD…" : `${picker.label}…`}
        options={picker.choices.map((choice) => ({
          value: choice.value,
          label: choice.label,
          keywords: choice.keywords,
          icon: choice.icon ? <MenuIconView icon={choice.icon} /> : undefined,
        }))}
        selected={picker.selected}
        multiple={picker.multiple}
        onSelect={onSelect}
        onCreate={
          picker.creatable && onCreate
            ? (query) => {
                // 期日は YYYY-MM-DD の形のときだけ保存する。それ以外の言葉は日付として読めないので何もしない
                if (isDate && !DATE_PATTERN.test(query)) return
                onCreate(query)
              }
            : undefined
        }
        createLabel={(query) =>
          isDate
            ? DATE_PATTERN.test(query)
              ? `Set due date to ${query}`
              : "Type a date as YYYY-MM-DD"
            : `Create label "${query}"`
        }
        onClose={closeAndReturn}
      />
    </div>
  )
}
