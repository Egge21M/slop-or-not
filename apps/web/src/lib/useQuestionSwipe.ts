import { useRef, type PointerEvent } from "react"

// A deliberate horizontal gesture or upward gesture shares the button actions.
// Interactive children retain their own pointer behavior.
export function useQuestionSwipe({
  disabled,
  onBinary,
  onCustom,
}: {
  disabled: boolean
  onBinary: (value: "yes" | "no") => void
  onCustom?: () => void
}) {
  const start = useRef<{ id: number; x: number; y: number } | null>(null)
  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (disabled || !event.isPrimary || event.button !== 0) return
      if ((event.target as HTMLElement).closest("button,a,input,textarea,select")) return
      start.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const origin = start.current
      start.current = null
      if (disabled || !origin || origin.id !== event.pointerId) return
      const dx = event.clientX - origin.x
      const dy = event.clientY - origin.y
      if (Math.abs(dx) >= 70 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        onBinary(dx > 0 ? "yes" : "no")
      } else if (dy <= -70 && Math.abs(dy) > Math.abs(dx) * 1.3) {
        onCustom?.()
      }
    },
    onPointerCancel() { start.current = null },
    onLostPointerCapture() { start.current = null },
  }
}
