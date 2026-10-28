/**
 * Keep a room/space identifier on compact timetable cards.
 * The slot's date/time and programme already appear in the surrounding UI.
 * Preserve other template names as entered by administrators.
 */
export function compactSessionTemplateLabel(label: string): string {
    const trimmed = label.trim()
    const sourceSpace = trimmed.match(/^(MTDC\s+Source\s+Space\s+\d+)\b/i)
    return sourceSpace ? sourceSpace[1].replace(/\s+/g, " ") : trimmed
}
