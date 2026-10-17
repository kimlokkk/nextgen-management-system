"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

type TableScrollAreaProps = {
    children: ReactNode
    label: string
    className?: string
}

type ScrollPosition = {
    overflow: boolean
    left: boolean
    right: boolean
}

export function TableScrollArea({ children, label, className = "" }: TableScrollAreaProps) {
    const viewportRef = useRef<HTMLDivElement>(null)
    const [position, setPosition] = useState<ScrollPosition>({
        overflow: false,
        left: false,
        right: false,
    })

    useEffect(() => {
        const viewport = viewportRef.current
        if (!viewport) return

        const measure = () => {
            const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
            const current = viewport.scrollLeft
            const next: ScrollPosition = {
                overflow: maxScroll > 2,
                left: current > 2,
                right: current < maxScroll - 2,
            }
            setPosition((previous) => (
                previous.overflow === next.overflow
                && previous.left === next.left
                && previous.right === next.right
            ) ? previous : next)
        }

        // ResizeObserver also notices when a table expands after data is rendered.
        const observer = new ResizeObserver(measure)
        observer.observe(viewport)
        const table = viewport.querySelector("table")
        if (table) observer.observe(table)

        viewport.addEventListener("scroll", measure, { passive: true })
        // Browsers fire the initial ResizeObserver callback asynchronously.
        return () => {
            observer.disconnect()
            viewport.removeEventListener("scroll", measure)
        }
    }, [])

    const move = (direction: -1 | 1) => {
        const viewport = viewportRef.current
        if (!viewport) return
        viewport.scrollBy({
            left: direction * Math.max(240, viewport.clientWidth * 0.72),
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                ? "instant"
                : "smooth",
        })
    }

    return (
        <div className={`table-scroll-area w-full min-w-0 max-w-full ${className}`}>
            {position.overflow && (
                <div className="flex min-w-0 items-center justify-between gap-2 border-b bg-accent/40 px-3 py-2 sm:px-4">
                    <span className="min-w-0 text-xs font-medium text-muted-foreground">
                        Scroll sideways to see all columns
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                        <button type="button" onClick={() => move(-1)} disabled={!position.left}
                            aria-label={`Scroll ${label} left`}
                            className="flex size-9 items-center justify-center rounded-lg border bg-background text-foreground transition-colors hover:bg-accent disabled:opacity-30">
                            <ChevronLeft className="size-4" aria-hidden="true" />
                        </button>
                        <button type="button" onClick={() => move(1)} disabled={!position.right}
                            aria-label={`Scroll ${label} right`}
                            className="flex size-9 items-center justify-center rounded-lg border bg-background text-foreground transition-colors hover:bg-accent disabled:opacity-30">
                            <ChevronRight className="size-4" aria-hidden="true" />
                        </button>
                    </div>
                </div>
            )}
            <div
                ref={viewportRef}
                role="region"
                aria-label={`${label} (scroll horizontally if needed)`}
                tabIndex={position.overflow ? 0 : -1}
                className="table-scroll-viewport w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain"
            >
                {children}
            </div>
        </div>
    )
}
