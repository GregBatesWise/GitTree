// IPC channel names shared between main and preload.

export const CH = {
  reposList: 'repos:list',
  repoAdd: 'repos:add',
  repoRemove: 'repos:remove',
  openFolder: 'dialog:openFolder',

  status: 'git:status',
  log: 'git:log',
  branches: 'git:branches',
  stashes: 'git:stashes',
  remotes: 'git:remotes',
  diffWorking: 'git:diffWorking',
  commitFiles: 'git:commitFiles',
  commitFileDiff: 'git:commitFileDiff',
  compareFiles: 'git:compareFiles',
  compareFileDiff: 'git:compareFileDiff',

  stage: 'git:stage',
  unstage: 'git:unstage',
  stageAll: 'git:stageAll',
  unstageAll: 'git:unstageAll',
  discard: 'git:discard',
  commit: 'git:commit',
  checkout: 'git:checkout',
  createBranch: 'git:createBranch',
  merge: 'git:merge',
  deleteBranch: 'git:deleteBranch',
  push: 'git:push',
  pull: 'git:pull',
  fetch: 'git:fetch',
  stashSave: 'git:stashSave',
  stashApply: 'git:stashApply',
  stashDrop: 'git:stashDrop',
  addRemote: 'git:addRemote',
  removeRemote: 'git:removeRemote'
} as const

export type ChannelName = (typeof CH)[keyof typeof CH]
