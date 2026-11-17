// A hand-written dialect, to prove `connections[].dialect` accepts a module path.
export const dialect = {
  name: 'custom',
  toTsType: (dataType) => ({ INT: 'number', STR: 'string' })[dataType],
  connect: async () => {
    const executed = []
    return {
      describe: async (text) =>
        text.includes('boom')
          ? { ok: false, message: 'boom', position: text.indexOf('boom') }
          : {
              ok: true,
              columns: [
                { name: 'id', dataType: 'INT', nullability: 'not-null' },
                { name: 'note', dataType: 'STR', nullability: 'nullable' },
                {
                  name: 'executed',
                  dataType: executed.length > 0 ? 'STR' : null,
                  nullability: 'unknown',
                },
              ],
              parameters: undefined,
            },
      exec: async (sqlText) => {
        if (sqlText.includes('fail')) throw new Error('cannot run this')
        executed.push(sqlText)
      },
      close: async () => {},
    }
  },
}
