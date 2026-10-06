import { useState } from 'react'
import { ArrowRight, BookOpenCheck, ChevronRight, FolderHeart, Lightbulb, Monitor, PenLine, Save, Settings2 } from 'lucide-react'
import { useLocaleStore } from '../../stores/locale-store'
import { useLayoutStore } from '../../stores/layout-store'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/Dialog'
import BrandMark from '../brand/BrandMark'

interface UserGuideProps { open: boolean; onClose: () => void }

/** Local, bilingual help. Opening it never scans models or starts a workflow. */
export default function UserGuide({ open, onClose }: UserGuideProps) {
  const text = useLocaleStore(s => s.text)
  const [active, setActive] = useState(0)
  const openSettings = useLayoutStore(s => s.openSettings)
  const openNewProject = useLayoutStore(s => s.openNewProject)
  const sections = [
    {
      icon: Monitor,
      title: text('先认识墨墅', 'Meet Moshu'),
      intro: text('把墨墅想成一间书房：作品是书，模型是你请来的写作助手。软件能打开，不等于助手已经到位。', 'Think of Moshu as your writing room. Your projects are books, and a model is your writing assistant. Opening the app does not mean a model is ready.'),
      steps: [
        text('发行版从桌面“墨墅”或解压目录的 Moshu.exe 启动；只有源码版使用「一键启动.bat」并保留启动器窗口。', 'Launch the release from its desktop shortcut or the extracted Moshu.exe. Only source mode uses the one-click script and its console.'),
        text('自己写作和查看文件不需要 AI。要让 AI 生成正文，需要先准备模型服务和模型，再在设置里连接。', 'You do not need AI to edit or read. AI writing requires a model service, an installed model, and a saved connection.'),
        text('第一次建议按顺序走：连接模型 → 新建小说 → 故事架构 → 章节蓝图 → 第一章。不要急着批量生成整本书。', 'Start with a model connection, a new novel, story architecture, a chapter blueprint, then one chapter. Leave batch generation for later.'),
      ],
      tip: text('你的已有作品和模型配置会保留。墨墅是新的显示名称，旧项目不需要转换格式。', 'Your existing projects and model profiles remain intact. Moshu is a new display name, not a new project format.'),
    },
    {
      icon: Settings2,
      title: text('连接本地模型', 'Connect a local model'),
      intro: text('完整版已内置 Ollama 与 llama.cpp，不捆绑 LM Studio，也不包含模型权重。下载完整 GGUF 后即可在软件内导入。', 'The full release includes Ollama and llama.cpp, not LM Studio or model weights. Import a complete GGUF after downloading it.'),
      steps: [
        text('从发布者的夸克网盘下载完整 GGUF；链接尚未配置时，已有文件仍可导入。只从可信来源获取模型。', 'Download a complete GGUF from the publisher’s Quark share. Existing files can be imported before the link is configured. Use trusted model sources.'),
        text('打开「设置 → AI 生成模型 → 内置本地模型」，点击「导入 GGUF 文件」。', 'Open Settings → Generation models → Embedded local models, then import a GGUF file.'),
        text('建议先选 llama.cpp、自动设备和 4096 上下文；内存不足时降低上下文或改用小模型。', 'Start with llama.cpp, automatic device selection and a 4096-token context. Reduce context or model size if memory is insufficient.'),
        text('点击「启用并设为默认」，软件自动加载并保存连接，无需填写地址。Ollama 首次导入另需缓存空间。', 'Activate and set as default to load the model and save its connection automatically. Ollama needs additional cache space for its first import.'),
        text('就绪后先写一小段做验收；保留原始 GGUF 文件。外部 Ollama / LM Studio 仍可通过下方快速配置连接。', 'Write a short test passage once ready, and keep the original GGUF file. External Ollama and LM Studio remain available in quick setup below.'),
      ],
      tip: text('「AI 生成模型」负责写文章；「向量模型」负责找资料，两者不是一回事。暂未配置向量模型仍可使用全文检索。', 'Generation models write; embedding models help retrieve references. They are different. Full-text search still works without an embedding model.'),
    },
    {
      icon: FolderHeart,
      title: text('新建一部小说', 'Create a novel'),
      intro: text('软件里的「项目」，就是一本小说连同它的设定、人物、蓝图和正文。', 'A project contains one novel, its settings, characters, plans, and manuscripts.'),
      steps: [
        text('在首页点击「新建小说」，填写作品名称。比如《风停在山海之间》。', 'Select New novel on the home screen and enter a title, such as Where the Wind Rests.'),
        text('点击「选择」设置保存位置。建议为这部小说准备一个单独的文件夹，不要和软件源码或其他小说混在一起。', 'Choose a save location. Use a dedicated folder for this book, separate from the software and other projects.'),
        text('点击「创建项目」。进入后，在「小说配置」中填写题材、受众、写作语言和你的创作想法。', 'Create the project, then fill in its genre, audience, writing language, and premise in Novel configuration.'),
        text('之后可以从首页「我的书架」继续打开，也可以用「打开作品」选择原来的小说项目文件夹。', 'Return through Your bookshelf, or choose Open a project and select the existing project folder.'),
      ],
      tip: text('记住保存位置。软件文件夹不是小说文件夹；备份启动脚本，也不等于备份了小说。', 'Remember the save location. Backing up the launcher does not back up your novel.'),
    },
    {
      icon: Lightbulb,
      title: text('先搭好故事骨架', 'Plan the story'),
      intro: text('别把所有设定一次塞给 AI。先讲清楚故事，再分配每一章要完成的事情。', 'Start with a clear story, then decide what each chapter needs to accomplish.'),
      steps: [
        text('在「小说配置」里，用几句话写清楚：主角是谁、想得到什么、遇到什么阻碍、故事大致怎样结束。', 'In Novel configuration, describe the protagonist, their goal, the obstacle, and the broad ending.'),
        text('生成或整理「故事架构」，检查世界观和人物设定。AI 提出的内容需要你确认，不合适的就先改。', 'Generate or edit the story architecture, then check the world and characters. Revise anything that does not fit your intent.'),
        text('打开左侧「蓝图」，生成章节计划。蓝图就是每一章的任务单，不是最终正文。', 'Open Plot to create chapter plans. A blueprint is a chapter brief, not the final manuscript.'),
        text('先检查第一章：开场在哪里、出现谁、发生什么、结尾留下什么悬念。确认后再写这一章。', 'Check the first chapter’s setting, cast, events, and closing hook before writing it.'),
      ],
      tip: text('故事架构是整本书的地图，章节蓝图是这一章的路线。准备得清楚，后面的正文更容易保持一致。', 'Story architecture is the map of the book; a blueprint is the route through one chapter.'),
    },
    {
      icon: PenLine,
      title: text('写出第一章', 'Write the first chapter'),
      intro: text('先跑通一章，再考虑批量写作。你负责判断内容，AI 负责帮你起草和修改。', 'Complete one chapter before trying batch writing. AI drafts and revises; you make the creative decisions.'),
      steps: [
        text('从章节蓝图点击「写作此章」，确认本次创作模型、章节号、目标字数和本章要写的内容。', 'Choose Write this chapter from its blueprint. Confirm the model, chapter number, target length, and chapter brief.'),
        text('点击「开始创作」，在「任务」或右侧「AI 输出」查看进度。不要连续点击启动，也不要在生成时强行关闭软件。', 'Start writing and watch Tasks or AI output. Do not start duplicate runs or force-close the app during generation.'),
        text('生成的是草稿。先通读，确认人名、时间线、情节和语气；需要时手动修改，或使用修稿、审稿功能。', 'The result is a draft. Check names, continuity, plot, and tone; edit it or use the revision and review tools.'),
        text('确认这一章可以作为后续故事的依据，再执行「定稿」。定稿不是发布，它会更新后续章节要参考的记录。', 'Finalize only when the chapter is ready to become the basis for later chapters. Finalization updates story records; it does not publish your book.'),
        text('后续章节通常需要前一章完成定稿。遇到前置条件提示，请先补齐提示中缺少的蓝图或定稿步骤。', 'Later chapters normally require the previous chapter to be finalized. Follow any prerequisite message about plans or finalized chapters.'),
      ],
      tip: text('保存解决“修改有没有留下”；定稿解决“这一章是否确认完成”。两件事不能互相代替。', 'Saving preserves edits. Finalizing confirms a chapter for the story pipeline. They are not interchangeable.'),
    },
    {
      icon: Save,
      title: text('保存、导出与备份', 'Save, export, and back up'),
      intro: text('把作品交给别人看，用导出；防止整个项目丢失，用备份。', 'Export when sharing a manuscript. Back up to protect the complete project.'),
      steps: [
        text('修改后留意顶部保存状态；有未保存内容时，用当前编辑器的保存功能或 Ctrl+S。看到「已保存」再退出。', 'Watch the save indicator. Use the editor’s save action or Ctrl+S for unsaved changes, and wait for Saved before closing.'),
        text('先完成需要导出的章节定稿，再点击顶部「导出」。此功能只导出已定稿章节。给别人阅读可选「纯文本 TXT」；要保留结构可选「合并 Markdown」或「分章 Markdown」。', 'Finalize the chapters first, then choose Export. Only finalized chapters are included. Use Plain text for easy reading, or merged/chapter Markdown for structured files.'),
        text('选择导出目录，等到成功提示，再到那个文件夹查看。导出正文不等于备份全部人物、设定和项目数据。', 'Choose a destination and wait for success. A manuscript export is not a full backup of settings and project data.'),
        text('做完整备份时，先保存并关闭小说项目，再复制整个小说文件夹到另一个磁盘。涉及模型密钥的配置不要公开分享。', 'For a full project backup, save and close it, then copy the entire novel folder to another drive. Never publicly share configuration files containing API keys.'),
      ],
      tip: text('「从最近项目移除」只清理列表记录；「删除项目」会删除真实文件。删除前一定看清确认提示。', 'Removing a recent entry only clears the list. Deleting a project removes real files. Read confirmation dialogs carefully.'),
    },
    {
      icon: BookOpenCheck,
      title: text('遇到问题怎么办', 'When something goes wrong'),
      intro: text('先看是哪一步出了问题，不要一遇到报错就重装全部软件。', 'Identify the failing step first. You rarely need to reinstall everything.'),
      steps: [
        text('软件启动失败：看启动窗口最后的错误和 .runtime/launcher/logs 日志。ECONNRESET / fetch failed 常出现在依赖下载阶段，先等有限重试；不要随便删除锁文件。', 'Startup failed: check the console and .runtime/launcher/logs. ECONNRESET / fetch failed can occur during dependency downloads. Wait for bounded retries; do not delete lockfiles blindly.'),
        text('检测不到模型：确认 Ollama 在运行，或 LM Studio 已打开本地服务器；列表为空时，要先在对应服务里自行准备模型。', 'No models found: check that Ollama or the LM Studio server is running. An empty list means you need to prepare a model in that service.'),
        text('模型已配置但生成失败：重新测试连接，确认模型 ID 和实际服务一致。显存不足时先换小一点的模型，或降低服务的上下文 / 输出设置。', 'Generation failed: test the connection and model ID. For memory errors, try a smaller model or reduce the server context/output settings.'),
        text('无法开始下一章：查看提示中缺少的步骤，通常与本章蓝图或上一章定稿有关，不是重新下载软件就能解决。', 'The next chapter is blocked: follow the prerequisite message, usually about a blueprint or previous finalization.'),
        text('需要求助：提供最后一段错误、正在进行的操作和日志时间。不要发送 API Key、完整个人配置或不想公开的小说内容。', 'When asking for help, share the final error, the action you were taking, and the log time. Omit API keys and private writing.'),
      ],
      tip: text('墨墅不会因为本地模型连接失败就偷偷切换云端。你选择的模型和服务，始终由你决定。', 'Moshu does not silently switch to the cloud when a local connection fails. Model choice stays in your control.'),
    },
  ]
  const current = sections[active]

  return (
    <Dialog open={open} onOpenChange={value => { if (!value) onClose() }}>
      <DialogContent className="moshu-guide w-[calc(100vw-3rem)] max-w-[1040px] h-[min(740px,calc(100dvh-64px))] overflow-hidden p-0">
        <header className="moshu-guide-header"><span className="moshu-logo-tile"><BrandMark /></span><div><DialogTitle className="text-[22px]">{text('墨墅 · 使用指南', 'Moshu · Getting started')}</DialogTitle><DialogDescription>{text('不用懂技术，跟着一步一步来。', 'No technical background needed. Take it one step at a time.')}</DialogDescription></div></header>
        <div className="moshu-guide-layout">
          <nav aria-label={text('指南目录', 'Guide contents')} className="moshu-guide-nav">
            {sections.map((section, index) => <button type="button" key={index} aria-current={active === index ? 'step' : undefined} className={active === index ? 'is-active' : ''} onClick={() => setActive(index)}><section.icon size={17} /><span>{section.title}</span><ChevronRight size={14} /></button>)}
          </nav>
          <main className="moshu-guide-content" key={active}>
            <span className="moshu-eyebrow">{text(`新手手册 / 0${active + 1}`, `QUICK START / 0${active + 1}`)}</span>
            <h2>{current.title}</h2><p className="moshu-guide-intro">{current.intro}</p>
            <ol>{current.steps.map((step, index) => <li key={index}><span>{String(index + 1).padStart(2, '0')}</span><p>{step}</p></li>)}</ol>
            <aside className="moshu-guide-tip"><Lightbulb size={18} /><p>{current.tip}</p></aside>
            <div className="moshu-guide-actions">
              {active === 1 && <button type="button" className="moshu-primary" onClick={() => { onClose(); openSettings('llm') }}>{text('去配置模型', 'Open model settings')}<ArrowRight size={16} /></button>}
              {active === 2 && <button type="button" className="moshu-primary" onClick={() => { onClose(); openNewProject() }}>{text('新建我的小说', 'Create my novel')}<ArrowRight size={16} /></button>}
              {active < sections.length - 1 && <button type="button" className="moshu-secondary" onClick={() => setActive(active + 1)}>{text('下一步', 'Next')}<ArrowRight size={16} /></button>}
            </div>
          </main>
        </div>
      </DialogContent>
    </Dialog>
  )
}
