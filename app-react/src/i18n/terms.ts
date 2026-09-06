/**
 * 服务条款内容（四语）。结构参考通用服务条款骨架，
 * 内容为 isaSpectrum 网站整体撰写。
 * 新增键请同步四种语言；缺失语言渲染时回落英文由 TermsPage 处理。
 */
import type { Locale } from './messages';

export interface TermsSection {
  title: string;
  paragraphs: string[];
}

export interface TermsContent {
  updated: string;
  intro: string;
  sections: TermsSection[];
}

const zh: TermsContent = {
  updated: '2026 年 9 月 6 日',
  intro:
    '本条款适用于 isaSpectrum 留言板网站。注册账号或使用本服务，即表示你已阅读并同意本条款；如不同意，请勿使用本服务。',
  sections: [
    {
      title: '服务提供方',
      paragraphs: [
        '本服务由 isaSpectrum 学生社区运营团队（下称"运营方"）面向校园社区提供，属非商业性质的校内服务。',
      ],
    },
    {
      title: '账号与安全',
      paragraphs: [
        '账号仅限本人使用，须以学校邮箱（@isawuhan.com）注册。邮箱密码是第一验证要素；通行密钥（指纹、面部或屏幕锁）是推荐的登录方式；手机号仅用于账号恢复与备用验证。',
        '请妥善保管你的设备与认证凭据，不得出借、转让账号，或与他人共享认证凭据。凭据丢失时，可通过备用验证码或联系运营方恢复访问。',
      ],
    },
    {
      title: '对使用者的期望',
      paragraphs: [
        '你应遵守本条款、校园规范及适用法律，尊重他人的权利，包括隐私权与知识产权。',
        '禁止以下行为：创建虚假账号或冒充他人；发布违法、骚扰、歧视、淫秽或侵犯他人权利的内容；发送垃圾信息或恶意链接；尝试绕过、破坏或对本服务的认证机制（包括发言门槛、限流与风控措施）进行测试攻击。',
      ],
    },
    {
      title: '发言权限与认证门槛',
      paragraphs: [
        '为保护社区环境，未绑定通行密钥的账号仅可浏览；绑定通行密钥后即可参与发言。运营方可根据社区管理需要调整该门槛，并会提前在站内公示。',
      ],
    },
    {
      title: '你发布的内容',
      paragraphs: [
        '你对自己发布的内容承担全部责任，并保留其所有权。发布内容即表示你授予本服务在站内展示与缓存该内容所必需的非独占许可，以便服务正常运行。',
        '运营方发现违反本条款的内容时，可予以移除，并可视情况通知发布者。',
      ],
    },
    {
      title: '出现问题时',
      paragraphs: [
        '若你的行为影响本服务的运营、完整性或安全，运营方可视情节采取警示、移除内容、暂停或终止账号、注销认证凭据等措施；涉嫌违法的，将依法配合处理。',
        '若你对相关措施有异议，可通过页面页脚的联系方式向运营方申诉。',
      ],
    },
    {
      title: '服务的变更与可用性',
      paragraphs: [
        '本服务按"现状"提供。运营方会尽力保障可用性并持续改进，但不对服务的无中断运行或特定功能的持续提供作出保证；必要时可能变更、暂停或停止部分功能，并会提前公告。',
      ],
    },
    {
      title: '免责声明与责任限制',
      paragraphs: [
        '在适用法律允许的最大范围内，运营方不对因使用或无法使用本服务而产生的间接损失承担责任。',
        '运营方已采取通行密钥、限流、风控等合理安全措施，但不保证认证机制能抵御所有攻击。请勿在多个站点重复使用同一密码。',
      ],
    },
    {
      title: '条款的修改',
      paragraphs: [
        '本条款可能随服务演进而更新。实质性变更会提前在站内公告；公告期满后你继续使用本服务，即视为接受修订后的条款。',
      ],
    },
    {
      title: '联系我们',
      paragraphs: ['对本条款或本服务有任何疑问，请通过校园社区管理渠道或页面页脚的联系方式与运营方取得联系。'],
    },
  ],
};

const en: TermsContent = {
  updated: 'September 6, 2026',
  intro:
    'These terms apply to the isaSpectrum message board website. By creating an account or using the service, you agree to these terms. If you do not agree, please do not use the service.',
  sections: [
    {
      title: 'Service provider',
      paragraphs: [
        'The service is provided to the campus community by the isaSpectrum student community operations team (the "operators") and is a non-commercial, on-campus service.',
      ],
    },
    {
      title: 'Your account and security',
      paragraphs: [
        'Accounts are for personal use only and must be registered with a school email address (@isawuhan.com). Your email password is the first factor; a passkey (fingerprint, face, or screen lock) is the recommended sign-in method; your phone number is used only for account recovery and backup verification.',
        'Keep your devices and credentials safe. Do not lend or transfer your account, or share your credentials with anyone. If you lose access, you can recover it with backup codes or by contacting the operators.',
      ],
    },
    {
      title: 'What we expect from you',
      paragraphs: [
        'You must follow these terms, campus rules, and applicable law, and respect the rights of others, including privacy and intellectual property.',
        'The following are prohibited: creating fake accounts or impersonating others; posting unlawful, harassing, discriminatory, obscene, or infringing content; sending spam or malicious links; attempting to bypass, disrupt, or test-attack the authentication mechanisms of this service (including the posting threshold, rate limiting, and anti-abuse measures).',
      ],
    },
    {
      title: 'Posting privileges and the verification threshold',
      paragraphs: [
        'To protect the community, accounts without a linked passkey can only browse. Once a passkey is linked, posting is unlocked. The operators may adjust this threshold for community management and will announce changes in advance.',
      ],
    },
    {
      title: 'Content you post',
      paragraphs: [
        'You are responsible for everything you post and retain ownership of it. By posting, you grant the service the non-exclusive license needed to display and cache that content within the site so it works as intended.',
        'The operators may remove content that violates these terms and may notify the author where appropriate.',
      ],
    },
    {
      title: 'When problems arise',
      paragraphs: [
        'If your actions affect the operation, integrity, or security of the service, the operators may issue warnings, remove content, suspend or terminate accounts, and deactivate credentials as appropriate; suspected unlawful activity will be handled in accordance with the law.',
        'If you disagree with such a measure, you can appeal through the contact channels linked in the page footer.',
      ],
    },
    {
      title: 'Changes and availability',
      paragraphs: [
        'The service is provided "as is". The operators work hard to keep it available and improve it, but do not guarantee uninterrupted operation or the indefinite availability of any feature. Features may be changed, paused, or retired when necessary, with notice given in advance.',
      ],
    },
    {
      title: 'Disclaimers and limitation of liability',
      paragraphs: [
        'To the maximum extent permitted by applicable law, the operators are not liable for indirect losses arising from the use of, or inability to use, the service.',
        'The operators apply reasonable security measures — passkeys, rate limiting, and anti-abuse controls — but cannot guarantee that the authentication mechanisms will withstand every attack. Do not reuse the same password across sites.',
      ],
    },
    {
      title: 'Changes to these terms',
      paragraphs: [
        'These terms may be updated as the service evolves. Material changes will be announced on the site in advance; continuing to use the service after the notice period means you accept the revised terms.',
      ],
    },
    {
      title: 'Contact us',
      paragraphs: ['For questions about these terms or the service, reach the operators via campus community channels or the contact information linked in the page footer.'],
    },
  ],
};

const es: TermsContent = {
  updated: '6 de septiembre de 2026',
  intro:
    'Estos términos aplican al sitio del tablón isaSpectrum. Al crear una cuenta o usar el servicio, aceptas estos términos. Si no los aceptas, no uses el servicio.',
  sections: [
    {
      title: 'Proveedor del servicio',
      paragraphs: [
        'El servicio lo ofrece a la comunidad del campus el equipo de operaciones de la comunidad estudiantil isaSpectrum (los "operadores") y es un servicio interno sin fines comerciales.',
      ],
    },
    {
      title: 'Tu cuenta y seguridad',
      paragraphs: [
        'Las cuentas son solo para uso personal y deben registrarse con un correo del colegio (@isawuhan.com). La contraseña del correo es el primer factor; una llave de acceso (huella, rostro o bloqueo de pantalla) es el método recomendado; el número de teléfono se usa solo para recuperación y verificación de respaldo.',
        'Cuida tus dispositivos y credenciales. No prestes ni transfieras tu cuenta ni compartas tus credenciales. Si pierdes el acceso, puedes recuperarlo con códigos de respaldo o contactando a los operadores.',
      ],
    },
    {
      title: 'Lo que esperamos de ti',
      paragraphs: [
        'Debes cumplir estos términos, las normas del campus y la ley aplicable, y respetar los derechos de otras personas, incluidos la privacidad y la propiedad intelectual.',
        'Está prohibido: crear cuentas falsas o suplantar identidades; publicar contenido ilegal, acosador, discriminatorio, obsceno o que infrinja derechos; enviar spam o enlaces maliciosos; intentar eludir, perturbar o poner a prueba los mecanismos de autenticación del servicio (incluidos el umbral de publicación, los límites de frecuencia y las medidas antimineras de abuso).',
      ],
    },
    {
      title: 'Permiso para publicar y umbral de verificación',
      paragraphs: [
        'Para proteger la comunidad, las cuentas sin llave de acceso vinculada solo pueden navegar. Al vincular una llave, se desbloquea la publicación. Los operadores pueden ajustar este umbral por gestión de la comunidad y lo anunciarán con antelación.',
      ],
    },
    {
      title: 'Contenido que publicas',
      paragraphs: [
        'Eres responsable de todo lo que publicas y conservas su propiedad. Al publicar, concedes al servicio la licencia no exclusiva necesaria para mostrar y almacenar en caché ese contenido dentro del sitio, para que funcione como es debido.',
        'Los operadores pueden retirar el contenido que viole estos términos y, si procede, avisar a su autor.',
      ],
    },
    {
      title: 'Cuando surgen problemas',
      paragraphs: [
        'Si tus acciones afectan al funcionamiento, la integridad o la seguridad del servicio, los operadores pueden avisar, retirar contenido, suspender o cerrar cuentas y desactivar credenciales, según corresponda; las posibles actividades ilícitas se tratarán conforme a la ley.',
        'Si no estás de acuerdo con una medida, puedes apelar por los canales de contacto del pie de página.',
      ],
    },
    {
      title: 'Cambios y disponibilidad',
      paragraphs: [
        'El servicio se ofrece "tal cual". Los operadores trabajan para mantenerlo disponible y mejorarlo, pero no garantizan un funcionamiento ininterrumpido ni la disponibilidad indefinida de funciones. Cuando sea necesario, pueden cambiar, pausar o retirar funciones, avisando con antelación.',
      ],
    },
    {
      title: 'Exención de responsabilidad y limitación',
      paragraphs: [
        'En la máxima medida permitida por la ley aplicable, los operadores no responden de pérdidas indirectas derivadas del uso o la imposibilidad de uso del servicio.',
        'Los operadores aplican medidas de seguridad razonables — llaves de acceso, límites de frecuencia y control antiminero — pero no pueden garantizar que los mecanismos de autenticación resistan todos los ataques. No reutilices la misma contraseña en otros sitios.',
      ],
    },
    {
      title: 'Cambios en estos términos',
      paragraphs: [
        'Estos términos pueden actualizarse a medida que evoluciona el servicio. Los cambios sustanciales se anunciarán en el sitio con antelación; seguir usando el servicio tras el periodo de aviso implica aceptar los términos revisados.',
      ],
    },
    {
      title: 'Contacto',
      paragraphs: ['Para preguntas sobre estos términos o el servicio, contacta con los operadores por los canales de la comunidad del campus o la información de contacto del pie de página.'],
    },
  ],
};

const ja: TermsContent = {
  updated: '2026 年 9 月 6 日',
  intro:
    '本規約は、isaSpectrum 掲示板サイトに適用されます。アカウントを作成または本サービスを利用することで、本規約に同意したものとみなされます。同意できない場合は、本サービスをご利用いただけません。',
  sections: [
    {
      title: 'サービスの提供者',
      paragraphs: [
        '本サービスは、isaSpectrum 学生コミュニティ運営チーム（以下「運営者」）がキャンパスコミュニティ向けに提供する、非営利の学内サービスです。',
      ],
    },
    {
      title: 'アカウントとセキュリティ',
      paragraphs: [
        'アカウントはご本人専用です。学校メールアドレス（@isawuhan.com）で登録してください。メールのパスワードが第一の認証要素で、パスキー（指紋・顔・画面ロック）が推奨のログイン方法、電話番号はアカウント復旧とバックアップ認証のみに使われます。',
        'デバイスと認証情報は大切に管理し、アカウントの貸与・譲渡や、認証情報の共有はしないでください。アクセスできなくなった場合は、リカバリーコードまたは運営者への連絡で復旧できます。',
      ],
    },
    {
      title: '利用者の皆さんへのお願い',
      paragraphs: [
        '本規約・学内規則・適用される法律を守り、プライバシーや知的財産を含む他人の権利を尊重してください。',
        '次の行為は禁止です：偽アカウントの作成やなりすまし、違法・ハラスメント・差別的・わいせつ・権利侵害となるコンテンツの投稿、スパムや悪意あるリンクの送信、投稿ハードル・レート制限・不正防止対策を含む認証メカニズムの回避・妨害・攻撃テスト。',
      ],
    },
    {
      title: '投稿権限と認証のハードル',
      paragraphs: [
        'コミュニティを守るため、パスキー未登録のアカウントは閲覧のみ可能です。パスキーを登録すると投稿できるようになります。運営者はコミュニティ管理のためこのハードルを変更することがあり、事前にサイト内でお知らせします。',
      ],
    },
    {
      title: '投稿したコンテンツについて',
      paragraphs: [
        '投稿内容の責任は投稿者が負い、所有権は投稿者に帰属します。投稿により、サービスが正常に動作するために必要な、サイト内表示とキャッシュを目的とした非独占のライセンスを本サービスに付与したものとみなされます。',
        '本規約に違反するコンテンツを運営者が発見した場合、削除することがあり、必要に応じて投稿者に通知します。',
      ],
    },
    {
      title: '問題が発生したとき',
      paragraphs: [
        '利用者の行為が本サービスの運営・完全性・安全性に影響する場合、運営者は警告、コンテンツの削除、アカウントの一時停止・終了、認証情報の無効化などを状況に応じて行います。違法が疑われる場合は法令に従って対応します。',
        'これらの措置に不服がある場合は、ページ下部の連絡先から運営者に申し立てできます。',
      ],
    },
    {
      title: 'サービスの変更と可用性',
      paragraphs: [
        '本サービスは「現状有姿」で提供されます。運営者は可用性の維持と改善に努めますが、中断のない動作や特定機能の永久提供を保証するものではありません。必要に応じて機能の変更・一時停止・終了を行うことがあり、事前にお知らせします。',
      ],
    },
    {
      title: '免責事項と責任の制限',
      paragraphs: [
        '適用法で認められる最大限の範囲で、運営者は本サービスの利用または利用不能から生じる間接損失について責任を負いません。',
        '運営者はパスキー、レート制限、不正防止など合理的な安全対策を講じていますが、すべての攻撃に耐えることを保証するものではありません。同じパスワードを複数のサイトで使い回さないでください。',
      ],
    },
    {
      title: '本規約の変更',
      paragraphs: [
        '本規約はサービスの進化に合わせて更新されることがあります。重要な変更は事前にサイト内で告知し、告知期間経過後に本サービスを継続利用した場合、改訂後の規約に同意したものとみなされます。',
      ],
    },
    {
      title: 'お問い合わせ',
      paragraphs: ['本規約や本サービスに関するご質問は、学内コミュニティの管理チャネルまたはページ下部の連絡先から運営者までお問い合わせください。'],
    },
  ],
};

export const termsContent: Record<Locale, TermsContent> = { zh, en, es, ja };
