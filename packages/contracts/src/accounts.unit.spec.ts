import {
  accountResponseSchema,
  createWorkspaceRequestSchema,
  loginRequestSchema,
  signupRequestSchema,
} from './index';

describe('Account request contracts', () => {
  const signup = {
    email: '  Planner@Example.com ',
    password: '  a long password  ',
    displayName: ' Ada ',
  };
  it('normalizes email and names, preserving password whitespace', () => {
    expect(signupRequestSchema.parse(signup)).toEqual({
      email: 'planner@example.com',
      password: signup.password,
      displayName: 'Ada',
    });
  });
  it.each([
    { ...signup, password: 'short' },
    { ...signup, password: 'x'.repeat(129) },
    { ...signup, email: 'bad' },
    { ...signup, displayName: ' ' },
    { ...signup, role: 'owner' },
  ])('rejects invalid signup or unexpected fields', (value) => {
    expect(signupRequestSchema.safeParse(value).success).toBe(false);
  });
  it('rejects client-selected workspace ownership', () => {
    expect(createWorkspaceRequestSchema.safeParse({ name: 'Team', userId: 'other' }).success).toBe(
      false,
    );
    expect(createWorkspaceRequestSchema.parse({ name: ' Team ' })).toEqual({ name: 'Team' });
  });
  it('requires login credentials and rejects missing account data', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@example.com', password: '' }).success).toBe(
      false,
    );
    expect(accountResponseSchema.safeParse({ user: {}, workspaces: [] }).success).toBe(false);
  });
});
