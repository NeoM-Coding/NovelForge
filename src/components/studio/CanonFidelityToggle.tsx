import type { InspireCanonFidelity } from "@/types/studio"

interface CanonFidelityToggleProps {
  value: InspireCanonFidelity
  onChange: (v: InspireCanonFidelity) => void
}

const OPTIONS: Array<{ value: InspireCanonFidelity; label: string; desc: string }> = [
  { value: "strict", label: "严格", desc: "完全绑定设定库" },
  { value: "moderate", label: "适度", desc: "允许次要扩展" },
  { value: "inspired", label: "启发", desc: "大胆重新组合" },
]

export function CanonFidelityToggle({ value, onChange }: CanonFidelityToggleProps) {
  return (
    <div className="mt-2">
      <p className="text-[10px] text-white/40 mb-1">设定遵循度</p>
      <div className="flex bg-white/5 rounded-lg p-0.5" role="group" aria-label="设定遵循度">
        {OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            title={opt.desc}
            aria-pressed={value === opt.value}
            className={`flex-1 px-2 py-1 rounded-md text-[10px] transition-colors ${
              value === opt.value
                ? "bg-amber-500/20 text-amber-400"
                : "text-white/50 hover:text-white/70"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}
