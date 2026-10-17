"use client";

import { buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Laptop, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

// Keep the server and first hydration render identical, then show theme UI.
const subscribe = () => () => {};

const ThemeSwitcher = () => {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const { theme, setTheme } = useTheme();

  if (!mounted) {
    return (
      <span aria-hidden="true" className="inline-block size-10 shrink-0 rounded-lg border bg-muted/50" />
    );
  }

  const ICON_SIZE = 16;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Choose appearance"
        title="Appearance: Light, Dark or System"
        className={buttonVariants({
          variant: "outline",
          className: "h-10 min-w-10 gap-2 rounded-lg border-border bg-background px-3 text-foreground shadow-none hover:border-primary/40 hover:bg-accent",
        })}
      >
        {theme === "light" ? (
          <Sun
            key="light"
            size={ICON_SIZE}
            className="text-primary"
          />
        ) : theme === "dark" ? (
          <Moon
            key="dark"
            size={ICON_SIZE}
            className="text-muted-foreground"
          />
        ) : (
          <Laptop
            key="system"
            size={ICON_SIZE}
            className="text-muted-foreground"
          />
        )}
        <span className="hidden text-xs font-medium sm:inline">Theme</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-36 rounded-lg border bg-popover p-1 shadow-lg" align="end">
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(e) => setTheme(e)}
        >
          <DropdownMenuRadioItem className="flex gap-2" value="light">
            <Sun size={ICON_SIZE} className="text-muted-foreground" />{" "}
            <span>Light</span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem className="flex gap-2" value="dark">
            <Moon size={ICON_SIZE} className="text-muted-foreground" />{" "}
            <span>Dark</span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem className="flex gap-2" value="system">
            <Laptop size={ICON_SIZE} className="text-muted-foreground" />{" "}
            <span>System</span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export { ThemeSwitcher };
