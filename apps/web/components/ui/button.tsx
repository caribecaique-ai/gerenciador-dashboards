import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: "default" | "outline" | "ghost" | "destructive";
    size?: "default" | "sm" | "lg" | "icon";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant = "default", size = "default", ...props }, ref) => {
        const variants: Record<string, string> = {
            default: "bg-blue-600 text-white hover:bg-blue-700",
            outline: "border border-gray-300 bg-white hover:bg-gray-50",
            ghost: "hover:bg-gray-100",
            destructive: "bg-red-500 text-white hover:bg-red-600",
        };
        const sizes: Record<string, string> = {
            default: "h-10 px-4 py-2",
            sm: "h-8 px-3 text-sm",
            lg: "h-12 px-6",
            icon: "h-10 w-10",
        };
        return (
            <button
                ref={ref}
                className={cn(
                    "inline-flex items-center justify-center rounded-md font-medium transition-colors focus:outline-none disabled:opacity-50",
                    variants[variant],
                    sizes[size],
                    className
                )}
                {...props}
            />
        );
    }
);
Button.displayName = "Button";

export { Button };
