"""Check the public template's technical repository contract (no app execution)."""
import json
import re
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[1]

def require(condition, message):
    if not condition:
        raise SystemExit(message)

def main():
    required = ['AGENTS.md', 'README.md', 'LICENSE', 'mise.toml', 'project.json',
                '.github/CODEOWNERS', '.github/pull_request_template.md',
                'docs/development.md', 'docs/testing.md', '.neander/Dockerfile',
                '.neander/compose.yaml', '.neander/template.yaml',
                '.github/workflows/check.yml', '.github/workflows/security.yml']
    for filename in required:
        require((ROOT / filename).is_file(), f'Missing {filename}')
    project = json.loads((ROOT / 'project.json').read_text())
    package = json.loads((ROOT / 'package.json').read_text())
    require(project['schemaVersion'] == 1, 'Unknown project metadata version')
    require(re.fullmatch(r'[a-z][a-z0-9-]*', project['slug']), 'Invalid project slug')
    require(project['lifecycle'] == 'published', 'This contract is for an existing published template')
    require(project['repositoryVisibility'] == 'public', 'Published template visibility metadata differs')
    require('MIT License' in (ROOT / 'LICENSE').read_text(), 'Preserve the existing MIT license')
    require('* @sourabhagrawal' in (ROOT / '.github/CODEOWNERS').read_text(), 'Missing maintainer ownership')
    scripts = package['scripts']
    for name in ['check', 'test', 'build', 'verify', 'test:policy', 'test:production', 'test:template']:
        require(bool(scripts.get(name)), f'Missing {name} command')
    require(scripts['test:production'] == scripts['test:template'], 'Production entry point must preserve the app smoke suite')
    require('test:policy' in scripts['verify'] and 'build' in scripts['verify'], 'verify must include policy and build')
    workflows = ROOT / '.github/workflows'
    for file in workflows.glob('*.yml'):
        raw = file.read_text()
        # BaseLoader avoids YAML 1.1 treating GitHub's "on" key as a boolean.
        data = yaml.load(raw, Loader=yaml.BaseLoader)
        require(data.get('permissions') == {'contents': 'read'}, f'{file.name}: workflow permissions must be read-only')
        require('pull_request_target' not in data.get('on', {}), 'Never execute app code through pull_request_target')
        require('secrets.' not in raw, f'{file.name}: public checks must not require repository/cloud secrets')
        for job in data['jobs'].values():
            require('permissions' not in job, f'{file.name}: unexpected elevated job permissions')
            for step in job.get('steps', []):
                action = step.get('uses', '')
                if action:
                    require(re.search(r'@[a-f0-9]{40}$', action), f'{file.name}: action must be pinned by SHA: {action}')
                if action.startswith('actions/checkout@'):
                    require(step.get('with', {}).get('persist-credentials') == 'false', f'{file.name}: checkout must discard credentials')
    checks = yaml.load((workflows / 'check.yml').read_text(), Loader=yaml.BaseLoader)
    require(set(['policy', 'app', 'production']).issubset(checks['jobs']), 'Missing standard check jobs')
    require(checks['jobs']['production']['name'] == 'Runtime security', 'Preserve the existing required runtime check context')
    require(any('test:production' in step.get('run', '') for step in checks['jobs']['production']['steps']), 'Production smoke must execute')
    require('schedule' in checks['on'], 'Keep daily runtime security verification')
    node = re.search(r'^node = "([^"]+)"', (ROOT / 'mise.toml').read_text(), re.M).group(1)
    for job in checks['jobs'].values():
        for step in job.get('steps', []):
            if step.get('uses', '').startswith('actions/setup-node@'):
                require(step['with']['node-version'] == node, 'CI and local Node pins must match')
    print(f"Repository contract passed: {project['name']}")

if __name__ == '__main__':
    main()
