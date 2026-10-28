
/** Import a PRIVATE CSV into local postgres only. Source rows are immutable.
 * Usage: NEXTGEN_LOCAL_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
 *   node scripts/import-mtdc-september-local.mjs private/NextGen_MTDC_September2026_PRIVATE_Evidence.csv --confirm-local
 */
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve, join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
const root=resolve(fileURLToPath(new URL("..",import.meta.url)))
const csv=resolve(process.argv[2]??"")
const db=process.env.NEXTGEN_LOCAL_DATABASE_URL
if(process.argv[3]!=="--confirm-local")throw Error("Require --confirm-local; production import forbidden")
if(!db||!existsSync(csv))throw Error("Missing private CSV or NEXTGEN_LOCAL_DATABASE_URL")
const u=new URL(db)
if(!["localhost","127.0.0.1","[::1]"].includes(u.hostname) ||
   !["postgres:","postgresql:"].includes(u.protocol))throw Error("Only localhost Postgres allowed")
if(!csv.startsWith(join(root,"private")+"/"))throw Error("CSV must be inside gitignored private/ directory")
const columns="source_batch,source_ref,source_tab,source_row,evidence_kind,student_name,class_date,start_time,end_time,week_number,space_label,course,module_raw,attendance_raw,original_date,original_raw,date_quality,header_raw"
const escaped=csv.replaceAll("'","''")
const sql=`\\set ON_ERROR_STOP on
begin;
create temporary table incoming_september (like public.legacy_september_evidence including defaults) on commit drop;
\\copy incoming_september (${columns}) from '${escaped}' with (format csv,header true,encoding 'UTF8')
insert into public.legacy_september_evidence (${columns})
select ${columns} from incoming_september
on conflict (source_batch,source_ref) do nothing;
commit;
select evidence_kind,count(*) from public.legacy_september_evidence
where source_batch='mtdc-2026-09' group by evidence_kind order by evidence_kind;
`
const temp=mkdtempSync(join(tmpdir(),"nextgen-sept-"))
try{
 const path=join(temp,"import.sql");writeFileSync(path,sql,{mode:0o600})
 const res=spawnSync("psql",[db,"-X","-v","ON_ERROR_STOP=1","-f",path],{encoding:"utf8"})
 if(res.error)throw res.error
 if(res.status!==0)throw Error(res.stderr||"Local psql import failed")
 process.stdout.write(res.stdout)
 process.stdout.write("Only local historical evidence was imported.\\n")
}finally{rmSync(temp,{recursive:true,force:true})}
