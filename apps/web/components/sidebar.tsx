"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
    { href: "/central", label: "Central" },
    { href: "/monitor", label: "Monitor" },
    { href: "/alerts", label: "Alertas" },
    { href: "/logs", label: "Logs" },
    { href: "/settings", label: "Config" },
];

export function Sidebar() {
    const pathname = usePathname();
    return (
        <aside className="w-56 bg-slate-900 text-white flex flex-col min-h-screen">
            <div className="p-4 border-b border-slate-700">
                <h1 className="text-lg font-bold">Dashboard<br />Manager</h1>
            </div>
            <nav className="flex-1 p-2 space-y-1">
                {links.map((link) => (
                    <Link
                        key={link.href}
                        href={link.href}
                        className={`block px-3 py-2 rounded-md text-sm font-medium transition-colors ${pathname === link.href
                                ? "bg-sky-600 text-white"
                                : "text-slate-300 hover:bg-slate-800"
                            }`}
                    >
                        {link.label}
                    </Link>
                ))}
            </nav>
        </aside>
    );
}
