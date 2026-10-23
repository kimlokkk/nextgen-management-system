"use client"

import { useFormStatus } from "react-dom"
import { LoaderCircle } from "lucide-react"

export function FormSubmit({ children }: { children: string }) {
    const { pending } = useFormStatus()

    return (
        <button type="submit" disabled={pending}
            aria-busy={pending}
            className="ui-primary-action w-full sm:w-auto">
            {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
            {pending ? "Saving…" : children}
        </button>
    )
}
