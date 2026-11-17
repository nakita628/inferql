import * as vscode from 'vscode'

import { completeSql } from './complete.js'
import type { SqlCompletion, SqlCompletionKind } from './complete.js'
import { findSqlLiteral, isWordStart } from './literal.js'
import { findProjectDir, readConnection } from './project.js'
import { SchemaCache } from './schema.js'

/**
 * InferQL for VS Code: completion inside `sql(...)` at the cursor — keywords, tables and
 * columns, each column with its table, database type and TypeScript type — from the tables the
 * project's migrations create, read through the project's own inferql (`inferql/introspect`).
 */

const KINDS: Readonly<Record<SqlCompletionKind, vscode.CompletionItemKind>> = {
  keyword: vscode.CompletionItemKind.Keyword,
  table: vscode.CompletionItemKind.Class,
  column: vscode.CompletionItemKind.Field,
  function: vscode.CompletionItemKind.Function,
  operator: vscode.CompletionItemKind.Operator,
}

const LANGUAGES = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact']

function toItem(item: SqlCompletion, range: vscode.Range): vscode.CompletionItem {
  const completion = new vscode.CompletionItem(item.label, KINDS[item.kind])
  completion.range = range
  completion.sortText = item.sortText
  if (item.detail !== undefined) completion.detail = item.detail
  if (item.documentation !== undefined) {
    completion.documentation = new vscode.MarkdownString(item.documentation)
  }
  return completion
}

function settings(scope: vscode.Uri) {
  const config = vscode.workspace.getConfiguration('inferql', scope)
  return {
    dialect: config.get<string>('dialect'),
    migrationsDir: config.get<string>('migrationsDir'),
    databaseUrl: config.get<string>('databaseUrl'),
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('InferQL')
  const cache = new SchemaCache()
  const reported = new Set<string>()

  const provider: vscode.CompletionItemProvider = {
    async provideCompletionItems(document, position) {
      const literal = findSqlLiteral(document.getText(), document.offsetAt(position))
      if (literal === undefined) return undefined
      const projectDir = findProjectDir(document.uri.fsPath)
      if (projectDir === undefined) return undefined
      const connection = readConnection(projectDir, settings(document.uri))
      if (connection === undefined) return undefined
      try {
        const schema = await cache.get(projectDir, connection)
        const { items, replace } = completeSql(literal.before, literal.text, schema)
        const range = new vscode.Range(position.translate(0, -replace), position)
        return new vscode.CompletionList(
          items.map((item) => toItem(item, range)),
          false,
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // Said once per project and message, not on every keystroke.
        if (!reported.has(projectDir + message)) {
          reported.add(projectDir + message)
          output.appendLine(`${projectDir}: cannot read the schema: ${message}`)
        }
        return undefined
      }
    },
  }

  // A migration, a tsconfig.json or the settings changing means a different schema.
  const watcher = vscode.workspace.createFileSystemWatcher('**/{*.sql,*.ts,tsconfig.json}')
  const refresh = (uri: vscode.Uri) => {
    if (uri.fsPath.endsWith('.ts') && !uri.fsPath.split(/[\\/]/u).includes('migrations')) return
    cache.clear()
  }
  context.subscriptions.push(
    output,
    watcher,
    watcher.onDidChange(refresh),
    watcher.onDidCreate(refresh),
    watcher.onDidDelete(refresh),
    // VS Code opens suggestions by itself in code, not inside a string: open them when a word
    // starts inside a sql(...) literal, so completing in the middle of a query needs no Ctrl+Space.
    vscode.workspace.onDidChangeTextDocument((event) => {
      const editor = vscode.window.activeTextEditor
      const [change] = event.contentChanges
      if (editor?.document !== event.document || event.contentChanges.length !== 1) return
      if (change === undefined) return
      const offset = event.document.offsetAt(change.range.start)
      const literal = findSqlLiteral(event.document.getText(), offset + change.text.length)
      if (literal === undefined) return
      if (!isWordStart(literal.before.slice(0, -change.text.length), change.text)) return
      void vscode.commands.executeCommand('editor.action.triggerSuggest')
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('inferql')) cache.clear()
    }),
    vscode.languages.registerCompletionItemProvider(
      LANGUAGES.map((language) => ({ language, scheme: 'file' })),
      provider,
      ' ',
      '.',
      ',',
      '(',
      '`',
      "'",
      '\n',
    ),
  )
}

export function deactivate(): void {
  // Everything is disposed through the context's subscriptions.
}
