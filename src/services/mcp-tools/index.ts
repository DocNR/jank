import contextVmServer from '../context-vm-server.service'
import { getAccountDef, getAccountHandler } from './get-account'
import { listColumnsDef, listColumnsHandler } from './list-columns'
import { getProfileDef, getProfileHandler } from './get-profile'
import { listNotesInColumnDef, listNotesInColumnHandler } from './list-notes-in-column'

/** Register all v1 MCP tools on the server registry.
 *  Called once at app boot from src/App.tsx (or equivalent boot path). */
export function registerAllTools(): void {
  contextVmServer.registerTool('get_account', getAccountDef, getAccountHandler)
  contextVmServer.registerTool('list_columns', listColumnsDef, listColumnsHandler)
  contextVmServer.registerTool('get_profile', getProfileDef, getProfileHandler)
  contextVmServer.registerTool(
    'list_notes_in_column',
    listNotesInColumnDef,
    listNotesInColumnHandler
  )
}
