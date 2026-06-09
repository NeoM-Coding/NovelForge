import { useNavigate } from "react-router"
import { trpc } from "@/providers/trpc"
import HeroBackground from "../sections/HeroBackground"
import LiquidGlassCard from "../components/LiquidGlassCard"
import ShimmerText from "../components/ShimmerText"
import Book3D from "../components/Book3D"
import NavBar from "../components/NavBar"
import { BookOpen, Database, PenTool, BookMarked, ChevronRight } from "lucide-react"

export default function Home() {
  const navigate = useNavigate()
  const { data: novels } = trpc.novel.list.useQuery()
  const { data: materials } = trpc.material.list.useQuery()
  const { data: works } = trpc.generate.list.useQuery()

  const novelCount = novels?.length || 0
  const materialCount = materials?.length || 0
  const workCount = works?.length || 0

  const recentNovels = novels?.slice(0, 3) || []

  return (
    <div className="min-h-screen bg-[#000000] text-[#FDFBF5] relative">
      <NavBar />
      <HeroBackground />

      <div className="relative max-w-[1400px] mx-auto px-4 md:px-8 py-16">
        <header className="mb-16">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-full bg-white/[0.03] backdrop-blur-md border border-white/10 max-w-2xl mx-auto">
            <span className="font-mono text-xs text-white/50 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              System • Translation Memory Active
            </span>
            <div className="flex gap-2 flex-wrap">
              {[
                { label: "翻译", path: "/library" },
                { label: "二创", path: "/studio" },
                { label: "设定库", path: "/lore" },
                { label: "素材池", path: "/materials" },
              ].map(({ label, path }) => (
                <button
                  key={label}
                  onClick={() => navigate(path)}
                  className="px-4 py-1.5 rounded-full text-sm bg-white/5 hover:bg-amber-500 text-white/70 hover:text-[#111827] border border-white/10 hover:border-amber-500 transition-colors font-mono"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </header>

        <div className="text-center mb-20">
          <h1 className="text-3xl sm:text-5xl font-serif font-bold mb-4 tracking-tight">
            <ShimmerText as="span">幻境小说工作台</ShimmerText>
          </h1>
          <p className="text-white/50 font-mono text-sm mb-8">
            AI 驱动的小说翻译与二创平台
          </p>
          <button
            onClick={() => navigate("/studio")}
            className="px-8 py-3 bg-amber-500 hover:bg-amber-400 text-[#111827] rounded-full font-bold transition-all shadow-lg shadow-amber-500/40 border border-amber-400 hover:shadow-xl hover:shadow-amber-500/50 hover:scale-105"
          >
            开始创作
          </button>
        </div>

        {/* Stats Dashboard */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto mb-16">
          {[
            { label: "小说", count: novelCount, icon: BookOpen, path: "/library" },
            { label: "素材", count: materialCount, icon: Database, path: "/materials" },
            { label: "二创", count: workCount, icon: PenTool, path: "/studio" },
            { label: "系列", count: works?.filter(w => w.seriesId).length || 0, icon: BookMarked, path: "/lore" },
          ].map(({ label, count, icon: Icon, path }) => (
            <button
              key={label}
              onClick={() => navigate(path)}
              className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-amber-500/20 hover:bg-white/[0.05] transition-all text-left group"
            >
              <Icon className="w-5 h-5 text-amber-500 mb-3" />
              <div className="text-2xl font-serif font-bold mb-1">{count}</div>
              <div className="text-white/40 text-xs font-mono flex items-center gap-1">
                {label}
                <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </button>
          ))}
        </div>

        {/* Recent Novels */}
        {recentNovels.length > 0 && (
          <div className="max-w-4xl mx-auto mb-16">
            <h2 className="font-mono text-xs uppercase tracking-wider text-white/40 mb-4">最近添加</h2>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {recentNovels.map(novel => (
                <button
                  key={novel.id}
                  onClick={() => navigate(`/reader/${novel.id}`)}
                  className="flex-shrink-0 p-4 rounded-xl bg-white/[0.03] border border-white/10 hover:border-amber-500/20 transition-all text-left w-64"
                >
                  <h3 className="font-serif text-sm font-semibold truncate">{novel.title}</h3>
                  <p className="text-white/30 text-xs font-mono mt-1">{novel.author || "未知作者"}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
          {[
            { title: "小说管理", desc: "上传、管理与翻译外文小说", path: "/library" },
            { title: "二创工作台", desc: "基于 AI 的小说续写与改写", path: "/studio" },
            { title: "设定库", desc: "管理角色卡、世界观与正史", path: "/lore" },
            { title: "素材池", desc: "向 RAG 记忆库投喂素材", path: "/materials" },
          ].map(({ title, desc, path }) => (
            <LiquidGlassCard
              key={title}
              onClick={() => navigate(path)}
            >
              <div className="p-6 text-left">
                <div className="flex items-center gap-3 mb-4">
                  <Book3D coverColor="#F59E0B" className="shrink-0" />
                </div>
                <h3 className="font-serif text-lg font-semibold mb-2">{title}</h3>
                <p className="text-white/50 text-sm">{desc}</p>
              </div>
            </LiquidGlassCard>
          ))}
        </div>

        <footer className="text-center mt-20 text-white/30 font-mono text-xs">
          <p>连接 DeepSeek API • 记忆库就绪 • 等待创作指令</p>
        </footer>
      </div>
    </div>
  )
}
