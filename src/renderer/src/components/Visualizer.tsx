import { useEffect, useRef } from 'react'
import { usePlayerStore } from '../state/playerStore'

export type VisualizerMode = 'bars' | 'wave' | 'radial'

interface VisualizerProps {
  mode: VisualizerMode
  accent: string
  className?: string
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value
  const int = parseInt(full, 16)
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255]
}

export function Visualizer({ mode, accent, className }: VisualizerProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const analyser = usePlayerStore((state) => state.backend.analyser)
  const isPlaying = usePlayerStore((state) => state.snapshot.state === 'playing')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !analyser) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const [r, g, b] = hexToRgb(accent)
    const freq = new Uint8Array(analyser.frequencyBinCount)
    const time = new Uint8Array(analyser.fftSize)
    let raf = 0
    let idle = 0

    const resize = (): void => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = canvas.clientWidth * dpr
      canvas.height = canvas.clientHeight * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const draw = (): void => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      ctx.clearRect(0, 0, width, height)
      analyser.getByteFrequencyData(freq)

      let energy = 0
      for (let i = 0; i < freq.length; i += 1) energy += freq[i]
      idle = energy === 0 ? idle + 0.02 : 0

      if (mode === 'bars') {
        const bars = 64
        const step = Math.floor(freq.length / bars)
        const gap = 2
        const barWidth = (width - gap * (bars - 1)) / bars
        for (let i = 0; i < bars; i += 1) {
          const magnitude = freq[i * step] / 255
          const h = Math.max(2, magnitude * height * 0.9)
          const x = i * (barWidth + gap)
          const grad = ctx.createLinearGradient(0, height, 0, height - h)
          grad.addColorStop(0, `rgba(${r},${g},${b},0.25)`)
          grad.addColorStop(1, `rgba(${r},${g},${b},0.95)`)
          ctx.fillStyle = grad
          ctx.fillRect(x, height - h, barWidth, h)
        }
      } else if (mode === 'wave') {
        analyser.getByteTimeDomainData(time)
        ctx.lineWidth = 2
        ctx.strokeStyle = `rgba(${r},${g},${b},0.9)`
        ctx.beginPath()
        const slice = width / time.length
        for (let i = 0; i < time.length; i += 1) {
          const v = time[i] / 128 - 1
          const y = height / 2 + v * height * 0.42
          if (i === 0) ctx.moveTo(0, y)
          else ctx.lineTo(i * slice, y)
        }
        ctx.stroke()
      } else {
        const cx = width / 2
        const cy = height / 2
        const radius = Math.min(width, height) * 0.24
        const points = 96
        ctx.beginPath()
        for (let i = 0; i <= points; i += 1) {
          const magnitude = freq[Math.floor((i / points) * freq.length)] / 255
          const angle = (i / points) * Math.PI * 2
          const rad = radius + magnitude * radius * 1.1
          const x = cx + Math.cos(angle) * rad
          const y = cy + Math.sin(angle) * rad
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.closePath()
        ctx.strokeStyle = `rgba(${r},${g},${b},0.85)`
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.fillStyle = `rgba(${r},${g},${b},0.08)`
        ctx.fill()
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [analyser, mode, accent, isPlaying])

  return <canvas ref={canvasRef} className={className} />
}
