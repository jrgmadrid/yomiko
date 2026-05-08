export const Channels = {
  overlaySetIgnore: 'overlay:set-ignore',
  textLine: 'text:line',
  textStatus: 'text:status',
  devPaste: 'dev:paste',
  tokenizeLine: 'tokenize:line',
  dictLookup: 'dict:lookup',
  dictLookupWithDeinflect: 'dict:lookup-with-deinflect'
} as const

export type ChannelName = (typeof Channels)[keyof typeof Channels]

export type SetIgnorePayload = { ignore: boolean }

export type SourceStatus = 'connected' | 'reconnecting' | 'disconnected'
