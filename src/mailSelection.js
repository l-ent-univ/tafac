// A message to open when the Messagerie page mounts (the dashboard's mail
// announcements open theirs), taken once.
let pendingMailId = null

export function requestMailMessage(id) {
  pendingMailId = id == null ? null : String(id)
}

export function takeRequestedMailMessage() {
  const id = pendingMailId
  pendingMailId = null
  return id
}
