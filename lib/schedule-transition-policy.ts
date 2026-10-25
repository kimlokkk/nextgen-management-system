export type ScheduleAction = "approve" | "lock"
export function validateScheduleTransition(status:string,action:ScheduleAction,valid:boolean,confirmed:boolean):string|null {
 if(action==="approve"&&status!=="draft")return "Only draft schedules can be approved"
 if(action==="lock"&&status!=="approved")return "Only approved schedules can be locked"
 if(!valid)return "Schedule has blocking validation issues"
 if(!confirmed)return action==="approve"?
  "Confirm dates, capacity and facilitators before approving":
  "Confirm the final operational release before locking"
 return null
}
