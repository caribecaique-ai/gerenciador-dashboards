export function Navbar() {
    return (
        <header className="h-16 border-b bg-white flex items-center px-6 justify-between">
            <h2 className="text-lg font-semibold text-slate-700">Central de Controle</h2>
            <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-sky-500 to-indigo-600" />
                <span className="text-sm font-medium text-slate-600">Admin</span>
            </div>
        </header>
    );
}
