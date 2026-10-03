import { createClient } from "@/lib/supabase/server"

export default async function SessionsPage() {
  const supabase = await createClient()

  const { data: sessions, error } = await supabase
    .from("session_templates")
    .select(`
      id,
      name,
      start_time,
      end_time,
      regular_capacity,
      replacement_capacity,
      branches (
        name
      ),
      programmes (
        name
      )
    `)
    .order("start_time")

  if (error) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-bold">Sessions</h1>

        <p className="mt-4 text-red-500">
          {error.message}
        </p>
      </main>
    )
  }

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-5xl">

        <h1 className="text-3xl font-bold">
          Class Sessions
        </h1>

        <p className="mt-2 text-muted-foreground">
          NextGen Management System
        </p>

        <div className="mt-8 overflow-hidden rounded-xl border">
          <table className="w-full text-sm">

            <thead className="border-b bg-muted/50">
              <tr>
                <th className="p-4 text-left">Branch</th>
                <th className="p-4 text-left">Programme</th>
                <th className="p-4 text-left">Session</th>
                <th className="p-4 text-left">Regular</th>
                <th className="p-4 text-left">Replacement</th>
              </tr>
            </thead>

            <tbody>
              {sessions?.map((session) => (
                <tr
                  key={session.id}
                  className="border-b last:border-0"
                >
                  <td className="p-4">
                    {session.branches?.name}
                  </td>

                  <td className="p-4">
                    {session.programmes?.name}
                  </td>

                  <td className="p-4">
                    <div className="font-medium">
                      {session.start_time.slice(0, 5)}
                      {" - "}
                      {session.end_time.slice(0, 5)}
                    </div>

                    <div className="text-xs text-muted-foreground">
                      {session.name}
                    </div>
                  </td>

                  <td className="p-4">
                    {session.regular_capacity}
                  </td>

                  <td className="p-4">
                    {session.replacement_capacity}
                  </td>
                </tr>
              ))}
            </tbody>

          </table>
        </div>

      </div>
    </main>
  )
}