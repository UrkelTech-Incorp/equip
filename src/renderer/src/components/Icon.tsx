interface IconProps {
  path: string
  size?: number
  fill?: boolean
}

export function Icon({ path, size = 18, fill = false }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={fill ? 'currentColor' : 'none'} aria-hidden="true">
      <path
        d={path}
        stroke={fill ? 'none' : 'currentColor'}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export const icons = {
  play: 'M8 5l11 7-11 7V5z',
  pause: 'M8 5h3v14H8zM13 5h3v14h-3z',
  prev: 'M6 5v14M18 6l-9 6 9 6V6z',
  next: 'M18 5v14M6 6l9 6-9 6V6z',
  shuffle: 'M18 4l3 3-3 3M3 7h4c4 0 4 10 8 10h6M18 14l3 3-3 3M15 7h6M3 17h4c1.4 0 2.4-1.2 3.2-2.6',
  repeat: 'M17 2l3 3-3 3M3 11V9a4 4 0 0 1 4-4h13M7 22l-3-3 3-3M21 13v2a4 4 0 0 1-4 4H4',
  repeatOne: 'M17 2l3 3-3 3M3 11V9a4 4 0 0 1 4-4h13M7 22l-3-3 3-3M21 13v2a4 4 0 0 1-4 4H4M12 10h1v4',
  volume: 'M11 5L6 9H3v6h3l5 4V5zM15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12',
  mute: 'M11 5L6 9H3v6h3l5 4V5zM17 9l4 4M21 9l-4 4',
  visualizer: 'M4 14v-4M8 18V6M12 21V3M16 17V7M20 14v-4',
  queue: 'M4 6h16M4 12h10M4 18h13M18 15v6l4-3-4-3z',
  library: 'M4 5h16M4 12h16M4 19h10',
  playlist: 'M4 6h11M4 12h11M4 18h7M17 12v7l4-2.5-4-2.5z',
  discover: 'M4 17l5-5 4 4 7-8M15 8h5v5',
  settings:
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2 3.5-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V22h-4v-.3a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1-2-3.5.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H2v-4h.3a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 2-3.5.1.1a1.7 1.7 0 0 0 1.9.3H8a1.7 1.7 0 0 0 1-1.5V2h4v.3a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 2 3.5-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H22v4h-.3a1.7 1.7 0 0 0-1.5 1z',
  add: 'M12 5v14M5 12h14',
  popout: 'M14 4h6v6M20 4l-8 8M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4',
  plusCircle: 'M12 8v8M8 12h8M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  equalizer: 'M6 4v10M6 18v2M12 4v4M12 12v8M18 4v8M18 16v4',
  cloud: 'M18 10h-1.3A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14'
}
