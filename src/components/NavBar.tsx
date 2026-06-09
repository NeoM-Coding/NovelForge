import { useNavigate, useLocation } from "react-router"
import { useState } from "react"
import { trpc } from "@/providers/trpc"
import { Home, BookOpen, PenTool, Library, Database, Search, X, Menu } from "lucide-react"

const NAV_ITEMS = [
  { path: "/", label: "首页", icon: Home },
  { path: "/library", label: "小说管理", icon: BookOpen },
  { path: "/studio", label: "二创工作台", icon: PenTool },
  { path: "/lore", label: "设定库", icon: Library },
  { path: "/materials", label: "素材池", icon: Database },
]

export default function NavBar() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  trpc.novel.search.useQuery(
    { query: searchQuery },
    { enabled: searchQuery.trim().length > 0 }
  )

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchQuery.trim()) {
      navigate("/library")
      setSearchOpen(false)
      setSearchQuery("")
    }
  }

  return (
    <>
      <nav className="sticky top-0 z-50 bg-[#111827]/90 backdrop-blur-md border-b border-white/10">
        <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center justify-between">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-[#FDFBF5] hover:text-amber-400 transition-colors"
          >
            <span className="font-serif text-lg font-bold tracking-tight">NovelForge</span>
          </button>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
              const isActive = location.pathname === path || (path !== "/" && location.pathname.startsWith(path))
              return (
                <button
                  key={path}
                  onClick={() => navigate(path)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors min-h-[44px] ${
                    isActive
                      ? "bg-amber-500/15 text-amber-400 border border-amber-500/20"
                      : "text-white/70 hover:text-white/90 hover:bg-white/5"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              )
            })}
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-lg hover:bg-white/10 min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="菜单"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          <div className="flex items-center">
            {searchOpen ? (
              <form onSubmit={handleSearch} className="flex items-center gap-2">
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="搜索小说..."
                  className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 focus:border-amber-500 outline-none text-sm text-[#FDFBF5] w-full sm:w-48 placeholder:text-white/40"
                />
                <button type="button" onClick={() => { setSearchOpen(false); setSearchQuery(""); }} className="p-1.5 rounded hover:bg-white/10">
                  <X className="w-4 h-4" />
                </button>
              </form>
            ) : (
              <button
                onClick={() => setSearchOpen(true)}
                className="p-2 rounded-full hover:bg-white/10 text-white/60 hover:text-white/90 transition-colors"
                title="搜索"
              >
                <Search className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* Mobile menu drawer */}
      {mobileMenuOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/60 z-40 md:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="fixed top-14 left-0 right-0 bg-[#111827]/95 backdrop-blur-md border-b border-white/10 z-50 md:hidden">
            <div className="px-4 py-3 space-y-1">
              {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
                const isActive = location.pathname === path || (path !== "/" && location.pathname.startsWith(path))
                return (
                  <button
                    key={path}
                    onClick={() => { navigate(path); setMobileMenuOpen(false); }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-colors min-h-[44px] ${
                      isActive
                        ? "bg-amber-500/15 text-amber-400"
                        : "text-white/70 hover:bg-white/5"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </>
  )
}
