import {
  AfterViewInit,
  Component,
  ElementRef,
  forwardRef,
  OnDestroy,
  ViewChild,
  ViewEncapsulation,
} from '@angular/core';
import {
  ControlValueAccessor,
  NG_VALUE_ACCESSOR,
} from '@angular/forms';
import Quill from 'quill';

@Component({
  selector: 'app-poll-body-editor',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  template:
    '<div class="poll-body-editor"><div #editor class="poll-body-editor__quill"></div></div>',
  styles: [
    `
      app-poll-body-editor {
        display: block;
      }
      .poll-body-editor {
        border-radius: 0.55rem;
        border: 1px solid var(--border);
        overflow: hidden;
        background: var(--surface);
      }
      .poll-body-editor .ql-toolbar.ql-snow {
        border: none;
        border-bottom: 1px solid var(--border);
        background: var(--surface-2);
      }
      .poll-body-editor .ql-container.ql-snow {
        border: none;
        font-family: inherit;
        font-size: 0.92rem;
        min-height: 9rem;
      }
    `,
  ],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => PollBodyEditorComponent),
      multi: true,
    },
  ],
})
export class PollBodyEditorComponent
  implements ControlValueAccessor, AfterViewInit, OnDestroy
{
  @ViewChild('editor') editorEl!: ElementRef<HTMLDivElement>;

  private quill?: Quill;
  private onChange: (v: string) => void = () => {};
  private onTouched: () => void = () => {};
  private pendingValue: string | null = null;
  private disabled = false;

  ngAfterViewInit(): void {
    this.quill = new Quill(this.editorEl.nativeElement, {
      theme: 'snow',
      placeholder:
        'Descrição opcional com formatação: títulos, listas, negrito, links…',
      modules: {
        toolbar: [
          [{ header: [2, 3, false] }],
          ['bold', 'italic', 'underline'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['link'],
          ['clean'],
        ],
      },
    });
    if (this.pendingValue !== null) {
      this.quill.root.innerHTML = this.pendingValue;
      this.pendingValue = null;
    }
    this.quill.on('text-change', () => {
      if (!this.disabled) {
        this.onChange(this.quill!.root.innerHTML);
      }
    });
    this.quill.on('selection-change', () => {
      this.onTouched();
    });
  }

  ngOnDestroy(): void {
    this.quill = undefined;
  }

  writeValue(obj: string | null | undefined): void {
    const v = obj ?? '';
    if (!this.quill) {
      this.pendingValue = v;
      return;
    }
    const cur = this.quill.root.innerHTML;
    if (cur !== v) {
      this.quill.root.innerHTML = v;
    }
  }

  registerOnChange(fn: (v: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
    this.quill?.enable(!isDisabled);
  }
}
