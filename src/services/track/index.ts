import fs from 'node:fs'
import path from 'node:path'

interface TrackEntry {
  id: string
  hash: string
  name: string
}

interface TrackJson {
  events: Record<string, TrackEntry>
  channels: Record<string, TrackEntry>
}

const getTrackJsonPath = () => path.resolve(process.cwd(), 'track.json')

const readTrackJson = (): TrackJson => {
  const trackJsonPath = getTrackJsonPath()
  if (!fs.existsSync(trackJsonPath)) {
    return { events: {}, channels: {} }
  }
  return JSON.parse(fs.readFileSync(trackJsonPath, 'utf-8'))
}

const writeTrackJson = (trackJson: TrackJson) => {
  fs.writeFileSync(getTrackJsonPath(), JSON.stringify(trackJson, null, 2))
}

export { readTrackJson, writeTrackJson }
export type { TrackEntry, TrackJson }
