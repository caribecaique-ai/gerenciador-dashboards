import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?: "default" | "outline" | "destructive";
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
    const variants: Record<string, string> = {
        default: "bg-blue-500 text-white",
        outline: "border border-gray-300 text-gray-700",
        destructive: "bg-red-500 text-white",
    };
    return (
        <div
            className={cn(
                "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
                variants[variant],
                className
            )}
            {...props}
        />
    );
}

export { Badge };
