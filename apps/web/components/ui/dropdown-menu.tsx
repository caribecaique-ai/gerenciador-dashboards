"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

const DropdownMenu = ({ children }: { children: React.ReactNode }) => (
    <div className="relative inline-block text-left">{children}</div>
);

const DropdownMenuTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
    ({ className, ...props }, ref) => <button ref={ref} className={cn("", className)} {...props} />
);
DropdownMenuTrigger.displayName = "DropdownMenuTrigger";

const DropdownMenuContent = ({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={cn("absolute right-0 z-10 mt-2 w-48 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5", className)} {...props}>
        {children}
    </div>
);

const DropdownMenuItem = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={cn("block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 cursor-pointer", className)} {...props} />
);

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem };
