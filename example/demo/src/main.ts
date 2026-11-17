import { sql } from './db.ts'

const users = sql('SELECT id, name, email FROM users')
// users: readonly {
//   readonly id: number
//   readonly name: string
//   readonly email: string | null
// }[]

console.log(users)
