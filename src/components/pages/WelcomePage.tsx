import { ArrowRight, BookOpen, BookOpenCheck, FileUp, FolderOpen, Plus, Settings2, Sparkles } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { useLayoutStore } from '../../stores/layout-store'
import { useLLMStore } from '../../stores/llm-store'
import { APP_BRAND } from '../../shared/brand'
import { useLocaleStore } from '../../stores/locale-store'
import { UpdateSection } from '../updates/UpdateSection'
import ReadingRoom from '../brand/ReadingRoom'

interface WelcomePageProps {
  onNewProject: () => void
  onOpenProject: () => void
  onImportNovel?: () => void
}

/** The author's front door. Every project/model indication comes from real store state. */
export default function WelcomePage({ onNewProject, onOpenProject, onImportNovel }: WelcomePageProps) {
  const recentProjects = useProjectStore(s => s.recentProjects)
  const openProject = useProjectStore(s => s.openProject)
  const currentProject = useProjectStore(s => s.currentProject)
  const models = useLLMStore(s => s.models)
  const defaultModelId = useLLMStore(s => s.defaultModelId)
  const openSettings = useLayoutStore(s => s.openSettings)
  const openGuide = useLayoutStore(s => s.openGuide)
  const text = useLocaleStore(s => s.text)
  const defaultModel = models.find(model => model.id === defaultModelId)

  return (
    <div className="moshu-welcome writer-shell-surface skin-workspace-page">
      <div className="moshu-home-wrap">
        <div className="moshu-home-heading">
          <div>
            <p className="moshu-eyebrow">{text('墨墅 · 私人小说创作室', 'MOSHU · YOUR PRIVATE WRITING ROOM')}</p>
            <p className="moshu-home-greeting">{text('欢迎回来，今天想写一个怎样的故事？', 'Welcome back. What story will you write today?')}</p>
          </div>
          <button type="button" className="moshu-text-button" onClick={openGuide}>
            <BookOpenCheck size={16} />{text('使用指南', 'Getting started')}
          </button>
        </div>

        <section className="moshu-hero" aria-label={text('开始写作', 'Start writing')}>
          <div className="moshu-hero-copy">
            <span className="moshu-overline"><span />{text('给灵感，一间自己的书房', 'A room of your own, for every idea')}</span>
            <h1>{currentProject ? currentProject.name : text('把心里的故事，', 'Make room for')}{!currentProject && <><br /><span>{text('写成一本书。', 'your next story.')}</span></>}</h1>
            <p>{text(APP_BRAND.tagline, APP_BRAND.taglineEn)}</p>
            <div className="moshu-hero-actions">
              <button type="button" className="moshu-primary" onClick={onNewProject}>
                <Plus size={18} />{text('新建小说', 'New novel')}<ArrowRight size={16} />
              </button>
              <button type="button" className="moshu-secondary" onClick={onOpenProject}>
                <FolderOpen size={17} />{text('打开作品', 'Open a project')}
              </button>
            </div>
            <span className="moshu-hero-note">{text('作品存于本机 · 创作节奏由你决定', 'Your projects stay on your computer. Write at your own pace.')}</span>
          </div>
          <ReadingRoom />
        </section>

        <div className="moshu-starter-grid">
          <button type="button" className="moshu-starter-card" onClick={() => openSettings('llm')}>
            <span className="moshu-card-icon"><Settings2 size={20} /></span>
            <span className="moshu-card-copy"><strong>{text('连接写作助手', 'Set up your writing assistant')}</strong><span>{text('先配置模型，再让 AI 帮你动笔', 'Connect a model before asking AI to write')}</span></span>
            <ArrowRight size={16} />
          </button>
          <button type="button" className="moshu-starter-card" onClick={openGuide}>
            <span className="moshu-card-icon"><BookOpenCheck size={20} /></span>
            <span className="moshu-card-copy"><strong>{text('从这里开始', 'Your first chapter starts here')}</strong><span>{text('一份不用懂技术的使用说明', 'A guide without the technical jargon')}</span></span>
            <ArrowRight size={16} />
          </button>
          <button type="button" className="moshu-starter-card" onClick={onImportNovel} disabled={!onImportNovel}>
            <span className="moshu-card-icon"><FileUp size={20} /></span>
            <span className="moshu-card-copy"><strong>{text('参考小说 · 拆解仿写', 'Study a reference novel')}</strong><span>{text('分析写法，为自己的故事找灵感', 'Learn the craft, then tell your own story')}</span></span>
            <ArrowRight size={16} />
          </button>
        </div>

        <section className="moshu-bookshelf" aria-labelledby="moshu-bookshelf-title">
          <div className="moshu-section-heading">
            <h2 id="moshu-bookshelf-title">{text('我的书架', 'Your bookshelf')}<span>{recentProjects.length}</span></h2>
            <button type="button" className="moshu-text-button" onClick={onOpenProject}>{text('打开其他作品', 'Open another project')}<ArrowRight size={15} /></button>
          </div>
          {recentProjects.length > 0 ? (
            <div className="moshu-book-grid">
              {recentProjects.map((project, index) => (
                <button type="button" key={project.path} className="moshu-book-card" onClick={() => void openProject(project.path)}
                  title={project.path} aria-label={text(`打开小说：${project.name}`, `Open novel: ${project.name}`)}>
                  <span className={`moshu-book-cover moshu-book-cover--${index % 3}`} aria-hidden="true"><BookOpen size={23} strokeWidth={1.25} /><span>{project.name.slice(0, 1)}</span></span>
                  <span className="moshu-book-info"><span className="moshu-book-label">{project.path === currentProject?.path ? text('当前作品', 'Current project') : text('最近打开', 'Recently opened')}</span><strong>{project.name}</strong><span className="moshu-book-path">{project.path}</span><span className="moshu-continue">{text('继续写作', 'Continue writing')}<ArrowRight size={14} /></span></span>
                </button>
              ))}
            </div>
          ) : (
            <div className="moshu-empty-shelf">
              <span className="moshu-empty-icon"><BookOpen size={27} strokeWidth={1.3} /></span>
              <div><h3>{text('书架还空着，故事从这里开始。', 'An empty shelf. A story waiting to be told.')}</h3><p>{text('新建一部小说，或打开你已经保存的作品文件夹。', 'Start a new novel, or open an existing project folder.')}</p></div>
              <button type="button" className="moshu-text-button" onClick={onNewProject}><Plus size={16} />{text('创建第一部作品', 'Create your first novel')}</button>
            </div>
          )}
        </section>

        <div className="moshu-home-footer">
          <span><Sparkles size={14} />{text('不必一次写完，今天写下一点就很好。', 'A little writing today is a good beginning.')}</span>
          <button type="button" className={`moshu-model-pill${defaultModel ? ' is-configured' : ''}`} onClick={() => openSettings('llm')}
            title={text('已配置不代表当前服务在线，请在设置中测试连接。', 'A saved profile does not prove the service is online. Test the connection in settings.')}>
            <span />{defaultModel ? text(`已配置：${defaultModel.name || defaultModel.modelName}`, `Configured: ${defaultModel.name || defaultModel.modelName}`) : text('模型待配置', 'Model setup needed')}
          </button>
        </div>
        <details className="moshu-update-section"><summary>{text('上游项目与更新', 'Upstream project & updates')}</summary><p className="text-xs my-3 text-[var(--color-text-muted)]">{text('墨墅为本地定制版。安装上游更新前，请备份定制代码和小说项目。', 'Moshu is a local customization. Back up customized code and novels before installing upstream updates.')}</p><UpdateSection /></details>
      </div>
    </div>
  )
}
