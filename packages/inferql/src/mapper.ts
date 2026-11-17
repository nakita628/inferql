/**
 * The process TypeScript starts for inferql's content mapper (`typescript.contentMapper` in
 * package.json, TypeScript 7.1+ with `--runExternalCode`). Everything is in content-mapper.ts.
 */
import { createMapperHandlers, serve } from './content-mapper.js'

serve(createMapperHandlers())
